package app.orbital;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Over-the-air frontend updates (docs/notes/ANDROID_UPDATES.md "OTA frontend").
 *
 * Newer web bundles built for the same shell API (shell-api.json "android",
 * BuildConfig.SHELL_API) are downloaded from the update feed into
 * files/ota/bundles/&lt;version&gt;/ and served by Capacitor's local server
 * (Bridge.setServerBasePath) instead of the bundle inside the APK. The origin stays
 * https://localhost, so IndexedDB and localStorage are kept. Capacitor itself drops
 * the persisted base path when a new APK is installed.
 *
 * A bundle that doesn't call confirmBoot() within BOOT_TIMEOUT_MS, or that was
 * still unconfirmed when the app was last started, is marked bad and the app goes
 * back to the bundle inside the APK. JS side: frontend/src/services/ota.ts.
 */
@CapacitorPlugin(name = "OtaBundle")
public class OtaBundlePlugin extends Plugin {

    private static final String TAG = "OtaBundle";
    private static final String PREFS = "OrbitalOta";
    private static final String KEY_ACTIVE = "active";
    private static final String KEY_PENDING = "pending";
    private static final String KEY_BAD = "bad";
    /** Version applied but not yet confirmed by the web app. */
    private static final String KEY_BOOTING = "booting";
    // Capacitor's own prefs (com.getcapacitor.plugin.WebView).
    private static final String CAP_PREFS = "CapWebViewSettings";
    private static final String CAP_SERVER_PATH = "serverBasePath";

    private static final long BOOT_TIMEOUT_MS = 30_000;
    private static final int TIMEOUT_MS = 30_000;
    private static final String INDEX_FILE = ".ota-manifest.json";
    private static final Pattern VERSION = Pattern.compile("^v?(\\d+)\\.(\\d+)\\.(\\d+)(?:-.*)?$");
    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    @Nullable
    private Runnable bootTimeout;
    private volatile boolean staging = false;

    // ── startup ───────────────────────────────────────────────────────────

    @Override
    public void load() {
        try {
            resolveStartup();
        } catch (Throwable t) {
            Log.e(TAG, "Startup failed, using the built-in bundle", t);
            clearPersistedPath();
        }
    }

    private void resolveStartup() {
        SharedPreferences p = prefs();
        String active = p.getString(KEY_ACTIVE, null);
        String pending = p.getString(KEY_PENDING, null);
        String booting = p.getString(KEY_BOOTING, null);
        Set<String> bad = readBad();

        // The previous launch never confirmed this bundle: it doesn't boot.
        if (booting != null && booting.equals(active)) {
            Log.e(TAG, "Bundle " + booting + " never confirmed its boot, falling back");
            bad.add(booting);
            writeBad(bad);
            active = null;
        }
        if (usable(pending, bad)) active = pending;
        if (!usable(active, bad)) active = null;

        p.edit().putString(KEY_ACTIVE, active).remove(KEY_PENDING).remove(KEY_BOOTING).apply();
        removeUnusedBundles(active, null);

        // Plugins load before the Bridge creates its local server and reads the
        // persisted base path (Bridge.loadWebView), so only set that path here.
        // Capacitor ignores it on the first start of a new APK (isNewBinary).
        SharedPreferences cap = getContext().getSharedPreferences(CAP_PREFS, Activity.MODE_PRIVATE);
        if (active == null) {
            cap.edit().putString(CAP_SERVER_PATH, "").commit();
            Log.i(TAG, "Using the built-in bundle " + apkVersion());
            return;
        }
        cap.edit().putString(CAP_SERVER_PATH, bundleDir(active).getAbsolutePath()).commit();
        armBootGuard(active);
        Log.i(TAG, "Using bundle " + active + " (APK " + apkVersion() + ")");
    }

    /** A staged bundle newer than the APK that isn't known to be broken. */
    private boolean usable(@Nullable String version, Set<String> bad) {
        if (version == null || bad.contains(version)) return false;
        Integer cmp = compareVersions(version, apkVersion());
        return cmp != null && cmp > 0 && new File(bundleDir(version), "index.html").isFile()
                && new File(bundleDir(version), INDEX_FILE).isFile();
    }

    // ── JS API ───────────────────────────────────────────────────────────

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("shellApi", BuildConfig.SHELL_API);
        ret.put("nativeVersion", apkVersion());
        ret.put("activeVersion", prefs().getString(KEY_ACTIVE, null));
        ret.put("pendingVersion", prefs().getString(KEY_PENDING, null));
        call.resolve(ret);
    }

    /**
     * Checks the manifest and downloads a newer bundle.
     * Resolves {result: "staged" | "native" | "none", version?, reason?}.
     */
    @PluginMethod
    public void stage(PluginCall call) {
        String manifestUrl = call.getString("manifestUrl");
        String backendUrl = call.getString("backendUrl", "");
        if (manifestUrl == null || !manifestUrl.startsWith("https://") && !manifestUrl.startsWith("http://")) {
            call.reject("manifestUrl is required");
            return;
        }
        if (staging) {
            call.reject("a check is already running");
            return;
        }
        staging = true;
        executor.execute(() -> {
            try {
                call.resolve(runStage(manifestUrl, backendUrl));
            } catch (Throwable t) {
                Log.w(TAG, "Staging failed", t);
                call.reject("OTA staging failed: " + t.getMessage());
            } finally {
                staging = false;
            }
        });
    }

    /** Switches to the pending bundle now (the web app reloads into it). */
    @PluginMethod
    public void apply(PluginCall call) {
        String pending = prefs().getString(KEY_PENDING, null);
        if (!usable(pending, readBad())) {
            call.resolve(new JSObject().put("applied", false));
            return;
        }
        prefs().edit().putString(KEY_ACTIVE, pending).remove(KEY_PENDING).apply();
        Log.i(TAG, "Applying " + pending);
        call.resolve(new JSObject().put("applied", true));
        main.post(() -> serveBundle(pending));
    }

    /** The web app mounted: the active bundle works. */
    @PluginMethod
    public void confirmBoot(PluginCall call) {
        main.post(() -> {
            if (bootTimeout != null) main.removeCallbacks(bootTimeout);
            bootTimeout = null;
        });
        String booting = prefs().getString(KEY_BOOTING, null);
        if (booting != null) Log.i(TAG, "Bundle " + booting + " booted");
        prefs().edit().remove(KEY_BOOTING).apply();
        executor.execute(() -> removeUnusedBundles(prefs().getString(KEY_ACTIVE, null), prefs().getString(KEY_PENDING, null)));
        call.resolve();
    }

    // ── serving ──────────────────────────────────────────────────────────

    private void serveBundle(String version) {
        String dir = bundleDir(version).getAbsolutePath();
        bridge.setServerBasePath(dir);
        getContext().getSharedPreferences(CAP_PREFS, Activity.MODE_PRIVATE).edit().putString(CAP_SERVER_PATH, dir).apply();
        armBootGuard(version);
    }

    private void useBuiltIn() {
        clearPersistedPath();
        bridge.setServerAssetPath("public");
    }

    private void clearPersistedPath() {
        getContext().getSharedPreferences(CAP_PREFS, Activity.MODE_PRIVATE).edit().putString(CAP_SERVER_PATH, "").apply();
    }

    private void armBootGuard(String version) {
        prefs().edit().putString(KEY_BOOTING, version).commit();
        if (bootTimeout != null) main.removeCallbacks(bootTimeout);
        bootTimeout = () -> {
            bootTimeout = null;
            if (!version.equals(prefs().getString(KEY_BOOTING, null))) return;
            Log.e(TAG, "Bundle " + version + " didn't confirm its boot, falling back");
            Set<String> bad = readBad();
            bad.add(version);
            writeBad(bad);
            prefs().edit().remove(KEY_ACTIVE).remove(KEY_BOOTING).apply();
            useBuiltIn();
        };
        main.postDelayed(bootTimeout, BOOT_TIMEOUT_MS);
    }

    // ── staging ──────────────────────────────────────────────────────────

    private static final class Entry {
        final String path;
        final String sha256;
        final long size;

        Entry(String path, String sha256, long size) {
            this.path = path;
            this.sha256 = sha256;
            this.size = size;
        }
    }

    private JSObject runStage(String manifestUrl, String backendUrl) throws Exception {
        JSONObject manifest = new JSONObject(new String(download(manifestUrl), StandardCharsets.UTF_8));
        String version = manifest.getString("version");
        int shellApi = manifest.getInt("shell_api");
        String manifestBackend = manifest.optString("backend_url", "");
        List<Entry> files = parseFiles(manifest.getJSONArray("files"));

        String apk = apkVersion();
        String active = prefs().getString(KEY_ACTIVE, null);
        String pending = prefs().getString(KEY_PENDING, null);
        String current = pending != null ? pending : active != null ? active : apk;

        JSObject ret = new JSObject();
        ret.put("version", version);
        if (parseVersion(apk) == null) return none(ret, "dev build");
        Integer newer = compareVersions(version, current);
        if (newer == null || newer <= 0) return none(ret, "up to date");
        if (shellApi > BuildConfig.SHELL_API) {
            ret.put("result", "native");
            return ret;
        }
        if (shellApi < BuildConfig.SHELL_API) return none(ret, "shell is newer than the bundle");
        if (!manifestBackend.isEmpty() && !backendUrl.isEmpty() && !manifestBackend.equals(backendUrl)) {
            return none(ret, "bundle is built for another backend");
        }
        if (readBad().contains(version)) return none(ret, "bundle failed to boot before");

        String blobBase = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1) + "ota/android/files/";
        stageBundle(version, files, blobBase, manifest.toString());

        prefs().edit().putString(KEY_PENDING, version).apply();
        if (pending != null && !pending.equals(version)) deleteRecursive(bundleDir(pending));
        ret.put("result", "staged");
        return ret;
    }

    private static JSObject none(JSObject ret, String reason) {
        ret.put("result", "none");
        ret.put("reason", reason);
        return ret;
    }

    private static List<Entry> parseFiles(JSONArray arr) throws Exception {
        List<Entry> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject f = arr.getJSONObject(i);
            String path = f.getString("path");
            String sha = f.getString("sha256");
            long size = f.getLong("size");
            if (!safePath(path) || !seen.add(path)) throw new IOException("bad path " + path);
            if (!SHA256.matcher(sha).matches() || size < 0) throw new IOException("bad entry " + path);
            out.add(new Entry(path, sha, size));
        }
        if (!seen.contains("index.html")) throw new IOException("manifest has no index.html");
        return out;
    }

    private static boolean safePath(String p) {
        if (p.isEmpty() || p.startsWith("/") || p.contains("\\") || p.indexOf('\0') >= 0) return false;
        for (String seg : p.split("/", -1)) {
            if (seg.isEmpty() || seg.equals(".") || seg.equals("..")) return false;
        }
        return true;
    }

    private void stageBundle(String version, List<Entry> files, String blobBase, String manifestJson) throws Exception {
        File target = bundleDir(version);
        if (new File(target, INDEX_FILE).isFile()) return;
        File tmp = new File(bundlesDir(), version + ".tmp");
        deleteRecursive(tmp);
        if (!tmp.mkdirs()) throw new IOException("cannot create " + tmp);

        Map<String, File> activeFiles = activeBundleFiles();
        int downloaded = 0;
        long bytes = 0;
        for (Entry f : files) {
            File dest = new File(tmp, f.path);
            if (!dest.getCanonicalPath().startsWith(tmp.getCanonicalPath() + File.separator)) {
                throw new IOException("unsafe path " + f.path);
            }
            File parent = dest.getParentFile();
            if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("cannot create " + parent);

            byte[] data = null;
            File local = activeFiles.get(f.sha256);
            if (local != null) data = readFile(local);
            if (data == null || !sha256(data).equals(f.sha256)) data = readBuiltIn(f);
            if (data == null) {
                data = download(blobBase + f.sha256);
                downloaded++;
                bytes += data.length;
            }
            if (data.length != f.size || !sha256(data).equals(f.sha256)) {
                throw new IOException("checksum mismatch for " + f.path);
            }
            try (FileOutputStream out = new FileOutputStream(dest)) {
                out.write(data);
            }
        }
        try (FileOutputStream out = new FileOutputStream(new File(tmp, INDEX_FILE))) {
            out.write(manifestJson.getBytes(StandardCharsets.UTF_8));
        }
        deleteRecursive(target);
        if (!tmp.renameTo(target)) throw new IOException("cannot rename " + tmp);
        Log.i(TAG, "Staged " + version + ": " + downloaded + " of " + files.size() + " files downloaded (" + bytes / 1024 + " KiB)");
    }

    /** Files of the active OTA bundle by sha256 (from its stored manifest). */
    private Map<String, File> activeBundleFiles() {
        Map<String, File> out = new HashMap<>();
        String active = prefs().getString(KEY_ACTIVE, null);
        if (active == null) return out;
        try {
            JSONObject m = new JSONObject(new String(readFile(new File(bundleDir(active), INDEX_FILE)), StandardCharsets.UTF_8));
            for (Entry e : parseFiles(m.getJSONArray("files"))) out.put(e.sha256, new File(bundleDir(active), e.path));
        } catch (Exception ignored) {
            // No usable index: those files are fetched again.
        }
        return out;
    }

    /** The same file from the bundle inside the APK, when it matches; else null. */
    @Nullable
    private byte[] readBuiltIn(Entry f) {
        try (InputStream in = getContext().getAssets().open("public/" + f.path)) {
            byte[] data = readAll(in);
            return data.length == f.size && sha256(data).equals(f.sha256) ? data : null;
        } catch (Exception e) {
            return null;
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private File bundlesDir() {
        return new File(new File(getContext().getFilesDir(), "ota"), "bundles");
    }

    private File bundleDir(String version) {
        return new File(bundlesDir(), version);
    }

    private Set<String> readBad() {
        Set<String> out = new HashSet<>();
        try {
            JSONArray arr = new JSONArray(prefs().getString(KEY_BAD, "[]"));
            for (int i = 0; i < arr.length(); i++) out.add(arr.getString(i));
        } catch (Exception ignored) {
            // Corrupt list: start over.
        }
        return out;
    }

    private void writeBad(Set<String> bad) {
        prefs().edit().putString(KEY_BAD, new JSONArray(bad).toString()).commit();
    }

    private void removeUnusedBundles(@Nullable String keepA, @Nullable String keepB) {
        File[] entries = bundlesDir().listFiles();
        if (entries == null) return;
        for (File f : entries) {
            String name = f.getName();
            if (name.equals(keepA) || name.equals(keepB)) continue;
            deleteRecursive(f);
        }
    }

    private String apkVersion() {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            return info.versionName != null ? info.versionName : "";
        } catch (Exception e) {
            return "";
        }
    }

    @Nullable
    static int[] parseVersion(String v) {
        java.util.regex.Matcher m = VERSION.matcher(v.trim());
        if (!m.matches()) return null;
        return new int[] { Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)) };
    }

    /** -1 / 0 / 1, or null when either side isn't a version. */
    @Nullable
    static Integer compareVersions(String a, String b) {
        int[] pa = parseVersion(a);
        int[] pb = parseVersion(b);
        if (pa == null || pb == null) return null;
        for (int i = 0; i < 3; i++) {
            if (pa[i] != pb[i]) return pa[i] < pb[i] ? -1 : 1;
        }
        return 0;
    }

    private static byte[] download(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(TIMEOUT_MS);
        conn.setReadTimeout(TIMEOUT_MS);
        conn.setUseCaches(false);
        try {
            int status = conn.getResponseCode();
            if (status != 200) throw new IOException("GET " + url + ": HTTP " + status);
            try (InputStream in = conn.getInputStream()) {
                return readAll(in);
            }
        } finally {
            conn.disconnect();
        }
    }

    @Nullable
    private static byte[] readFile(File f) {
        try (InputStream in = new FileInputStream(f)) {
            return readAll(in);
        } catch (IOException e) {
            return null;
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static String sha256(byte[] data) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder(digest.length * 2);
        for (byte b : digest) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static void deleteRecursive(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursive(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
