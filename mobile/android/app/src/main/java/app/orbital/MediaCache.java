package app.orbital;

import android.content.Context;
import android.util.Log;
import android.webkit.WebResourceResponse;
import androidx.annotation.Nullable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * On-disk LRU cache for chat attachment media (images, video, audio).
 *
 * The WebView loads https://localhost/_media/&lt;key&gt; (served by MediaCacheWebViewClient),
 * adding ?src=&lt;presigned S3 URL&gt; when the key isn't cached. Complete files are served
 * from disk with Range support (Capacitor's own _capacitor_file_ Range handling ignores the
 * start offset, so it can't seek). On a miss the request is proxied to S3 natively (no CORS)
 * and the bytes the WebView reads are teed into a sparse &lt;key&gt;.part file; received
 * byte ranges are tracked in memory and the file is promoted once they cover all of it.
 *
 * Port of electron/main/features/mediaCache.ts (+ mediaRanges.ts); keep limits and the
 * index format in step.
 */
final class MediaCache {

    private static final String TAG = "MediaCache";
    private static final long MAX_BYTES = 1024L * 1024 * 1024;
    /** Eviction trims down to this, so not every insert evicts. */
    private static final long TARGET_BYTES = (long) (MAX_BYTES * 0.9);
    /** Larger files stream through without being cached. */
    private static final long MAX_FILE_BYTES = 100L * 1024 * 1024;
    /** Partial downloads untouched for this long are dropped. */
    private static final long PART_IDLE_MS = 10 * 60 * 1000;
    /**
     * Skip warming when upstream was used this recently: Android's HttpURLConnection
     * keeps idle keep-alive connections for 5 minutes.
     */
    private static final long WARM_SKIP_MS = 4 * 60 * 1000;
    private static final int INDEX_VERSION = 1;
    private static final String INDEX_FILE = "index.json";
    static final Pattern KEY_PATTERN = Pattern.compile("^[A-Za-z0-9=-]+_(original|thumb)$");
    private static final Pattern RANGE = Pattern.compile("^bytes=(\\d*)-(\\d*)$");
    private static final Pattern CONTENT_RANGE = Pattern.compile("^bytes (\\d+)-(\\d+)/(\\d+)$");

    private static final class Entry {

        final long size;
        final String mime;
        long lastUsed;

        Entry(long size, String mime, long lastUsed) {
            this.size = size;
            this.mime = mime;
            this.lastUsed = lastUsed;
        }
    }

    private static final class Partial {

        final RandomAccessFile file;
        final long total;
        final String mime;
        /** Sorted, disjoint, non-adjacent half-open intervals [start, end). */
        List<long[]> ranges = new ArrayList<>();
        long lastTouch = System.currentTimeMillis();
        int openStreams = 0;
        /** Chunks queued on the writer thread; promotion waits for them. */
        int pendingWrites = 0;
        boolean done = false;

        Partial(RandomAccessFile file, long total, String mime) {
            this.file = file;
            this.total = total;
            this.mime = mime;
        }
    }

    @Nullable
    private static MediaCache instance;

    private static final AtomicInteger requestIds = new AtomicInteger();

    /** Logs to logcat (tag MediaCache) and to the app's debug log via MediaCachePlugin. */
    static void log(String level, String message) {
        switch (level) {
            case "error":
                Log.e(TAG, message);
                break;
            case "warn":
                Log.w(TAG, message);
                break;
            default:
                Log.i(TAG, message);
        }
        MediaCachePlugin.emitLog(level, message);
    }

    static void log(String level, String message, Throwable t) {
        log(level, message + ": " + t.getClass().getSimpleName() + ": " + t.getMessage());
    }

    private final File dir;
    private final Map<String, Entry> index = new HashMap<>();
    private final Map<String, Partial> partials = new HashMap<>();
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
    /**
     * Part-file writes run here, off the WebView's read thread. Single-threaded, so
     * a file's writes, its promotion and its close happen in order.
     */
    private final ExecutorService writer = Executors.newSingleThreadExecutor();
    /** Connection warm-up requests (network; kept off the other executors). */
    private final ExecutorService warmer = Executors.newSingleThreadExecutor();
    /** Upstream (S3) origin last fetched from, persisted for warm-up after restarts. */
    @Nullable
    private String origin;
    private long lastUpstreamAt = 0;
    @Nullable
    private ScheduledFuture<?> pendingSave;

    static synchronized MediaCache get(Context context) {
        if (instance == null) instance = new MediaCache(context.getApplicationContext());
        return instance;
    }

    private MediaCache(Context context) {
        dir = new File(context.getCacheDir(), "media");
        // Synchronously, before any part file exists (loading deletes stray ones).
        // First use is on a WebView IO or plugin thread, never the UI thread.
        loadIndex();
        executor.scheduleWithFixedDelay(this::dropIdlePartials, 1, 1, TimeUnit.MINUTES);
    }

    // ---- Ranges (mediaRanges.ts) ----

    static List<long[]> addRange(List<long[]> list, long start, long end) {
        if (end <= start) return list;
        List<long[]> out = new ArrayList<>();
        long s = start;
        long e = end;
        boolean placed = false;
        for (long[] r : list) {
            if (r[1] < s) {
                out.add(r);
            } else if (r[0] > e) {
                if (!placed) {
                    out.add(new long[] { s, e });
                    placed = true;
                }
                out.add(r);
            } else {
                s = Math.min(s, r[0]);
                e = Math.max(e, r[1]);
            }
        }
        if (!placed) out.add(new long[] { s, e });
        return out;
    }

    static boolean coversAll(List<long[]> list, long total) {
        return list.size() == 1 && list.get(0)[0] == 0 && list.get(0)[1] >= total;
    }

    // ---- Index ----

    private File fileFor(String key) {
        return new File(dir, key);
    }

    private File partFor(String key) {
        return new File(dir, key + ".part");
    }

    /** Loads the index and drops anything it can't vouch for (stale entries, orphans, .part files). */
    private synchronized void loadIndex() {
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        JSONObject entries = new JSONObject();
        try {
            File f = new File(dir, INDEX_FILE);
            if (f.exists()) {
                JSONObject raw = new JSONObject(new String(readAll(f), StandardCharsets.UTF_8));
                if (raw.optInt("version") == INDEX_VERSION && raw.optJSONObject("entries") != null) {
                    entries = raw.getJSONObject("entries");
                    String o = raw.optString("origin", "");
                    if (!o.isEmpty()) origin = o;
                } else {
                    log("info", "Index format changed, wiping cache");
                }
            }
        } catch (Exception e) {
            log("warn", "Index unreadable, starting empty", e);
        }
        File[] files = dir.listFiles();
        int dropped = 0;
        if (files != null) {
            for (File f : files) {
                String name = f.getName();
                if (name.equals(INDEX_FILE)) continue;
                JSONObject e = entries.optJSONObject(name);
                if (e != null && KEY_PATTERN.matcher(name).matches() && f.isFile() && f.length() == e.optLong("size", -1)) {
                    index.put(name, new Entry(e.optLong("size"), e.optString("mime", "application/octet-stream"), e.optLong("lastUsed")));
                } else {
                    deleteRecursive(f);
                    dropped++;
                }
            }
        }
        long total = 0;
        for (Entry e : index.values()) total += e.size;
        log("info", "Loaded index: " + index.size() + " file(s), " + total + " bytes, dropped " + dropped + " stray file(s), dir " + dir);
        scheduleSave();
    }

    private synchronized void scheduleSave() {
        if (pendingSave != null && !pendingSave.isDone()) return;
        pendingSave = executor.schedule(this::saveIndex, 2, TimeUnit.SECONDS);
    }

    private void saveIndex() {
        String json;
        synchronized (this) {
            try {
                JSONObject entries = new JSONObject();
                for (Map.Entry<String, Entry> e : index.entrySet()) {
                    JSONObject o = new JSONObject();
                    o.put("size", e.getValue().size);
                    o.put("mime", e.getValue().mime);
                    o.put("lastUsed", e.getValue().lastUsed);
                    entries.put(e.getKey(), o);
                }
                JSONObject root = new JSONObject();
                root.put("version", INDEX_VERSION);
                root.put("entries", entries);
                if (origin != null) root.put("origin", origin);
                json = root.toString();
            } catch (Exception e) {
                log("warn", "Serialising index failed", e);
                return;
            }
        }
        File tmp = new File(dir, INDEX_FILE + ".tmp");
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(tmp)) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            log("warn", "Saving index failed", e);
            return;
        }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(new File(dir, INDEX_FILE));
    }

    private synchronized void evictIfNeeded() {
        long total = 0;
        for (Entry e : index.values()) total += e.size;
        if (total <= MAX_BYTES) return;
        List<Map.Entry<String, Entry>> byAge = new ArrayList<>(index.entrySet());
        byAge.sort((a, b) -> Long.compare(a.getValue().lastUsed, b.getValue().lastUsed));
        int evicted = 0;
        for (Map.Entry<String, Entry> e : byAge) {
            if (total <= TARGET_BYTES) break;
            evicted++;
            index.remove(e.getKey());
            total -= e.getValue().size;
            //noinspection ResultOfMethodCallIgnored
            fileFor(e.getKey()).delete();
        }
        log("info", "LRU evicted " + evicted + " file(s), now " + total + " bytes");
        scheduleSave();
    }

    // ---- Partials ----

    private synchronized void dropPartial(String key) {
        Partial p = partials.remove(key);
        if (p == null) return;
        p.done = true;
        // Unlink now (a new partial may reuse the name); close on the writer thread
        // after any queued writes, which skip a done partial anyway.
        //noinspection ResultOfMethodCallIgnored
        partFor(key).delete();
        writer.execute(() -> closeQuietly(p.file));
    }

    private synchronized void dropIdlePartials() {
        long now = System.currentTimeMillis();
        for (String key : new ArrayList<>(partials.keySet())) {
            Partial p = partials.get(key);
            if (p != null && p.openStreams == 0 && p.pendingWrites == 0 && now - p.lastTouch > PART_IDLE_MS) dropPartial(key);
        }
    }

    @Nullable
    private synchronized Partial partialFor(String key, long total, String mime) {
        Partial existing = partials.get(key);
        if (existing != null && existing.total == total && !existing.done) return existing;
        // A different size means the file changed; start over.
        if (existing != null) {
            log("warn", "Partial " + key + " size changed " + existing.total + " -> " + total + ", restarting");
            dropPartial(key);
        }
        try {
            Partial p = new Partial(new RandomAccessFile(partFor(key), "rw"), total, mime);
            partials.put(key, p);
            return p;
        } catch (IOException e) {
            log("warn", "Opening part file failed for " + key, e);
            return null;
        }
    }

    /**
     * Queues bytes the WebView read for writing at their file offset. Called on the
     * WebView's read thread, so it only copies; the write happens on {@link #writer}.
     */
    private void record(String key, Partial p, byte[] buf, int off, int len, long offset) {
        if (len <= 0) return;
        synchronized (this) {
            if (p.done) return;
            p.pendingWrites++;
            p.lastTouch = System.currentTimeMillis();
        }
        byte[] chunk = Arrays.copyOfRange(buf, off, off + len);
        writer.execute(() -> writeChunk(key, p, chunk, offset));
    }

    /** Runs on the writer thread; promotes the file once every byte is written. */
    private void writeChunk(String key, Partial p, byte[] chunk, long offset) {
        boolean skip;
        synchronized (this) {
            skip = p.done;
            if (skip) p.pendingWrites--;
        }
        if (skip) return;
        try {
            // Only this thread touches the file (closes are queued here too), so no lock is held during I/O.
            p.file.seek(offset);
            p.file.write(chunk);
        } catch (IOException e) {
            synchronized (this) {
                p.pendingWrites--;
                if (!p.done) {
                    log("warn", "Write failed for " + key + " at " + offset, e);
                    dropPartial(key);
                }
            }
            return;
        }
        synchronized (this) {
            p.pendingWrites--;
            p.ranges = addRange(p.ranges, offset, offset + chunk.length);
            if (!p.done && p.pendingWrites == 0 && coversAll(p.ranges, p.total)) finalizePartial(key, p);
        }
    }

    private synchronized void finalizePartial(String key, Partial p) {
        p.done = true;
        partials.remove(key);
        closeQuietly(p.file);
        if (!partFor(key).renameTo(fileFor(key))) {
            log("warn", "Promoting " + key + " failed (rename)");
            //noinspection ResultOfMethodCallIgnored
            partFor(key).delete();
            return;
        }
        index.put(key, new Entry(p.total, p.mime, System.currentTimeMillis()));
        scheduleSave();
        evictIfNeeded();
    }

    // ---- Serving ----

    /** Handles GET /_media/&lt;key&gt;[?src=...]. */
    WebResourceResponse serve(String key, @Nullable String src, Map<String, String> requestHeaders) {
        int id = requestIds.incrementAndGet();
        String range = header(requestHeaders, "Range");
        Entry entry;
        synchronized (this) {
            entry = index.get(key);
            if (entry != null && !fileFor(key).isFile()) {
                log("warn", "#" + id + " " + key + " indexed but file missing");
                index.remove(key);
                scheduleSave();
                entry = null;
            }
            if (entry != null) {
                entry.lastUsed = System.currentTimeMillis();
                scheduleSave();
            }
        }
        try {
            if (entry != null) {
                return serveFile(fileFor(key), entry, range);
            }
            if (src == null || !(src.startsWith("https://") || src.startsWith("http://"))) {
                log("warn", "#" + id + " MISS " + key + " without src -> 404");
                return plain(404, "Not Found");
            }
            return proxy(id, key, src, range);
        } catch (Exception e) {
            log("error", "#" + id + " " + key + " failed -> 502", e);
            return plain(502, "Bad Gateway");
        }
    }

    private WebResourceResponse serveFile(File file, Entry entry, @Nullable String range) throws IOException {
        long size = entry.size;
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept-Ranges", "bytes");
        Matcher m = range != null ? RANGE.matcher(range.trim()) : null;
        if (m == null || !m.matches()) {
            headers.put("Content-Length", String.valueOf(size));
            return new WebResourceResponse(entry.mime, null, 200, "OK", headers, new FileInputStream(file));
        }
        long start;
        long end;
        if (m.group(1).isEmpty() && !m.group(2).isEmpty()) {
            start = Math.max(size - Long.parseLong(m.group(2)), 0);
            end = size - 1;
        } else {
            start = m.group(1).isEmpty() ? 0 : Long.parseLong(m.group(1));
            end = m.group(2).isEmpty() ? size - 1 : Long.parseLong(m.group(2));
        }
        if (start >= size || start > end) {
            log("warn", "Unsatisfiable range " + range + " for size " + size + " -> 416");
            headers.put("Content-Range", "bytes */" + size);
            return new WebResourceResponse(entry.mime, null, 416, "Range Not Satisfiable", headers, empty());
        }
        end = Math.min(end, size - 1);
        FileInputStream in = new FileInputStream(file);
        long skipped = 0;
        while (skipped < start) {
            long n = in.skip(start - skipped);
            if (n <= 0) break;
            skipped += n;
        }
        headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        headers.put("Content-Length", String.valueOf(end - start + 1));
        return new WebResourceResponse(entry.mime, null, 206, "Partial Content", headers, new RangeAlignedStream(new LimitedStream(in, end - start + 1), start));
    }

    private WebResourceResponse proxy(int id, String key, String src, @Nullable String range) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(src).openConnection();
        conn.setConnectTimeout(15_000);
        conn.setReadTimeout(30_000);
        // Byte offsets must refer to the stored file: no transparent gzip.
        conn.setRequestProperty("Accept-Encoding", "identity");
        if (range != null) conn.setRequestProperty("Range", range);
        int status = conn.getResponseCode();
        noteUpstream(conn.getURL());
        String reason = conn.getResponseMessage();
        if (reason == null || reason.isEmpty()) reason = status < 400 ? "OK" : "Error";
        String mime = conn.getContentType();
        if (mime == null) mime = "application/octet-stream";
        String bareMime = mime.split(";")[0].trim();

        Map<String, String> headers = new HashMap<>();
        for (String h : new String[] { "Content-Length", "Content-Range", "Accept-Ranges" }) {
            String v = conn.getHeaderField(h);
            if (v != null) headers.put(h, v);
        }

        // Errors (e.g. an expired link) pass through so the element's error handler refetches.
        if (status != 200 && status != 206) {
            log("warn", "#" + id + " " + key + " upstream error " + status + " passed through");
            InputStream err = conn.getErrorStream();
            return new WebResourceResponse(bareMime, null, status, reason, headers, err != null ? err : empty());
        }

        InputStream body = conn.getInputStream();
        long start = 0;
        long total = conn.getContentLengthLong();
        if (status == 206) {
            String cr = conn.getHeaderField("Content-Range");
            Matcher m = cr != null ? CONTENT_RANGE.matcher(cr.trim()) : null;
            if (m == null || !m.matches()) {
                log("warn", "#" + id + " unparsable Content-Range " + cr + ", not caching");
                return new WebResourceResponse(bareMime, null, status, reason, headers, new UpstreamStream(body, conn, id, key, 0));
            }
            start = Long.parseLong(m.group(1));
            total = Long.parseLong(m.group(3));
        }
        if (total <= 0 || total > MAX_FILE_BYTES) {
            return new WebResourceResponse(bareMime, null, status, reason, headers, new UpstreamStream(body, conn, id, key, start));
        }
        Partial p = partialFor(key, total, mime);
        if (p == null) return new WebResourceResponse(bareMime, null, status, reason, headers, new UpstreamStream(body, conn, id, key, start));
        return new WebResourceResponse(bareMime, null, status, reason, headers, new TeeStream(body, conn, id, key, p, start));
    }

    // ---- Connection warm-up ----

    private synchronized void noteUpstream(URL url) {
        lastUpstreamAt = System.currentTimeMillis();
        String o = url.getProtocol() + "://" + url.getAuthority();
        if (!o.equals(origin)) {
            origin = o;
            scheduleSave();
        }
    }

    /**
     * Opens a keep-alive connection to the S3 origin in the background, so the next
     * cache miss (e.g. opening a full-size image) skips DNS + TLS setup. Thumbnails
     * come from disk now, so nothing else warms that connection.
     */
    void warm() {
        String o;
        synchronized (this) {
            long now = System.currentTimeMillis();
            if (origin == null || now - lastUpstreamAt < WARM_SKIP_MS) return;
            o = origin;
            lastUpstreamAt = now;
        }
        warmer.execute(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(o + "/").openConnection();
                conn.setRequestMethod("HEAD");
                conn.setConnectTimeout(15_000);
                conn.setReadTimeout(15_000);
                int status = conn.getResponseCode();
                // Close the (empty) body without disconnect(), so the socket stays pooled.
                InputStream body = status < 400 ? conn.getInputStream() : conn.getErrorStream();
                if (body != null) body.close();
            } catch (Exception e) {
                log("warn", "Warming " + o + " failed", e);
                if (conn != null) conn.disconnect();
            }
        });
    }

    // ---- JS API (MediaCachePlugin) ----

    synchronized List<String> keys() {
        return new ArrayList<>(index.keySet());
    }

    /** Removes every variant of an attachment (it was deleted). */
    synchronized void evict(String id) {
        String prefix = id + "_";
        Iterator<String> it = index.keySet().iterator();
        while (it.hasNext()) {
            String key = it.next();
            if (!key.startsWith(prefix)) continue;
            it.remove();
            //noinspection ResultOfMethodCallIgnored
            fileFor(key).delete();
        }
        for (String key : new ArrayList<>(partials.keySet())) if (key.startsWith(prefix)) dropPartial(key);
        scheduleSave();
    }

    /** Empties the cache (logout). */
    synchronized void clear() {
        for (String key : new ArrayList<>(partials.keySet())) dropPartial(key);
        for (String key : index.keySet()) {
            //noinspection ResultOfMethodCallIgnored
            fileFor(key).delete();
        }
        index.clear();
        log("info", "Cleared cache");
        scheduleSave();
    }

    // ---- Streams and helpers ----

    /**
     * Upstream body handed to the WebView. Read errors (timeouts, resets) are logged:
     * the WebView reports them only as net::ERR_FAILED.
     */
    private class UpstreamStream extends RangeAlignedStream {

        protected final HttpURLConnection conn;
        protected final int id;
        protected final String key;
        protected long bytesRead = 0;
        protected boolean eof = false;
        private boolean closed = false;

        /** alignedAt: the file offset the upstream body starts at (its Content-Range start). */
        UpstreamStream(InputStream in, HttpURLConnection conn, int id, String key, long alignedAt) {
            super(in, alignedAt);
            this.conn = conn;
            this.id = id;
            this.key = key;
        }

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            int n = read(one, 0, 1);
            return n <= 0 ? -1 : one[0] & 0xff;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            int n;
            try {
                n = super.read(b, off, len);
            } catch (IOException | RuntimeException e) {
                log("warn", "#" + id + " " + key + " upstream read failed after " + bytesRead + " bytes", e);
                throw e;
            }
            if (n > 0) {
                onChunk(b, off, n);
                bytesRead += n;
            } else if (n < 0) {
                eof = true;
            }
            return n;
        }

        @Override
        protected long realSkip(long n) throws IOException {
            long s = super.realSkip(n);
            bytesRead += s;
            return s;
        }

        /** Called with every chunk passed to the WebView. */
        protected void onChunk(byte[] b, int off, int n) {}

        /** Called once when the WebView closes the stream. */
        protected void onClose() {}

        @Override
        public void close() throws IOException {
            if (!closed) {
                closed = true;
                onClose();
            }
            try {
                super.close();
            } finally {
                // A fully read body has already returned its socket to the keep-alive
                // pool; disconnect() would close it. An unfinished one can't be reused.
                if (!eof) conn.disconnect();
            }
        }
    }

    /** UpstreamStream that also records each chunk into the part file. */
    private final class TeeStream extends UpstreamStream {

        private final Partial partial;
        private final long startOffset;

        TeeStream(InputStream in, HttpURLConnection conn, int id, String key, Partial partial, long offset) {
            super(in, conn, id, key, offset);
            this.partial = partial;
            this.startOffset = offset;
            synchronized (MediaCache.this) {
                partial.openStreams++;
            }
        }

        @Override
        protected void onChunk(byte[] b, int off, int n) {
            record(key, partial, b, off, n, startOffset + bytesRead);
        }

        @Override
        protected void onClose() {
            synchronized (MediaCache.this) {
                partial.openStreams--;
                partial.lastTouch = System.currentTimeMillis();
            }
        }
    }

    /**
     * Android WebView applies a request's Range header to an intercepted response
     * itself: it sizes the stream with available() and skip()s to the range start
     * (which is why Capacitor answers Range requests with the whole file). Our
     * streams already begin at the range start (file offset, or upstream Range), so
     * the first alignedAt bytes of skipping are virtual, and available() reports 0
     * ("unknown") so the WebView doesn't bound the response by buffered bytes.
     */
    private static class RangeAlignedStream extends FilterInputStream {

        private long virtualRemaining;

        RangeAlignedStream(InputStream in, long alignedAt) {
            super(in);
            virtualRemaining = alignedAt;
        }

        @Override
        public int available() {
            return 0;
        }

        @Override
        public long skip(long n) throws IOException {
            if (n <= 0) return 0;
            if (virtualRemaining > 0) {
                long v = Math.min(n, virtualRemaining);
                virtualRemaining -= v;
                return v;
            }
            return realSkip(n);
        }

        protected long realSkip(long n) throws IOException {
            return in.skip(n);
        }
    }

    private static final class LimitedStream extends FilterInputStream {

        private long remaining;

        LimitedStream(InputStream in, long limit) {
            super(in);
            remaining = limit;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) return -1;
            int b = super.read();
            if (b >= 0) remaining--;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (remaining <= 0) return -1;
            int n = super.read(b, off, (int) Math.min(len, remaining));
            if (n > 0) remaining -= n;
            return n;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(super.available(), remaining);
        }
    }

    @Nullable
    private static String header(Map<String, String> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, String> e : headers.entrySet()) {
            if (e.getKey() != null && e.getKey().equalsIgnoreCase(name)) return e.getValue();
        }
        return null;
    }

    private static WebResourceResponse plain(int status, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", status, reason, new LinkedHashMap<>(), empty());
    }

    private static InputStream empty() {
        return new java.io.ByteArrayInputStream(new byte[0]);
    }

    private static byte[] readAll(File f) throws IOException {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int read = 0;
            while (read < buf.length) {
                int n = in.read(buf, read, buf.length - read);
                if (n < 0) break;
                read += n;
            }
            return buf;
        }
    }

    private static void closeQuietly(RandomAccessFile f) {
        try {
            f.close();
        } catch (IOException ignored) {
            // Already closed or unusable; nothing to do.
        }
    }

    private static void deleteRecursive(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursive(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
