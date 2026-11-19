package app.orbital;

import android.content.ClipData;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Pair;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;
import androidx.annotation.Nullable;
import androidx.core.view.ContentInfoCompat;
import androidx.core.view.ViewCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Receives images and stickers committed by Android keyboards (Gboard and
 * similar) and hands them to the text composer as temporary files. Enabled
 * only while that composer is focused, so unrelated WebView inputs keep their
 * normal behavior.
 */
@CapacitorPlugin(name = "KeyboardContent")
public class KeyboardContentPlugin extends Plugin {

    private static final long DEFAULT_MAX_BYTES = 20L * 1024 * 1024;
    private static final long TEMP_TTL_MINUTES = 10;
    private static final String[] IMAGE_MIME_TYPES = new String[] {
        "image/gif", "image/webp", "image/png", "image/jpeg"
    };

    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
    private volatile boolean enabled = false;
    private volatile long maxBytes = DEFAULT_MAX_BYTES;

    @Override
    public void load() {
        executor.execute(this::deleteTemporaryFiles);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        maxBytes = Math.max(1, call.getInt("maxBytes", (int) DEFAULT_MAX_BYTES));
        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            if (enabled) {
                ViewCompat.setOnReceiveContentListener(webView, IMAGE_MIME_TYPES, this::receiveContent);
                // Focus was established before the WebView knew about GIFs.
                // Recreate its InputConnection so Gboard sees the MIME types.
                InputMethodManager imm = webView.getContext().getSystemService(InputMethodManager.class);
                if (imm != null) imm.restartInput(webView);
            } else {
                ViewCompat.setOnReceiveContentListener(webView, null, null);
            }
            call.resolve();
        });
    }

    @Nullable
    private ContentInfoCompat receiveContent(View view, ContentInfoCompat payload) {
        if (!enabled) return payload;

        ClipData clip = payload.getClip();
        ContentResolver resolver = getContext().getContentResolver();
        for (int i = 0; i < clip.getItemCount(); i++) {
            Uri uri = clip.getItemAt(i).getUri();
            if (uri == null) continue;
            String mime = supportedMime(payload, resolver, uri);
            if (mime == null) continue;

            Pair<ContentInfoCompat, ContentInfoCompat> split = payload.partition(
                    item -> uri.equals(item.getUri()));
            final InputStream input;
            try {
                // Open while the keyboard's transient URI grant is active. The
                // open descriptor remains readable after this callback returns.
                input = resolver.openInputStream(uri);
            } catch (IOException | RuntimeException e) {
                emitError("read_failed");
                return split.second;
            }
            if (input == null) {
                emitError("read_failed");
                return split.second;
            }
            executor.execute(() -> copyAndEmit(uri, input, mime, maxBytes));
            return split.second;
        }
        return payload;
    }

    @Nullable
    private String supportedMime(ContentInfoCompat payload, ContentResolver resolver, Uri uri) {
        try {
            String providerMime = resolver.getType(uri);
            if (extensionForMime(providerMime) != null) return providerMime;
        } catch (RuntimeException ignored) {
            // Fall back to the keyboard's clip description.
        }
        for (String mime : IMAGE_MIME_TYPES) {
            if (payload.getClip().getDescription().hasMimeType(mime)) return mime;
        }
        return null;
    }

    @Nullable
    static String extensionForMime(@Nullable String mime) {
        if (mime == null) return null;
        switch (mime) {
            case "image/gif":
                return "gif";
            case "image/webp":
                return "webp";
            case "image/png":
                return "png";
            case "image/jpeg":
                return "jpg";
            default:
                return null;
        }
    }

    private void copyAndEmit(Uri source, InputStream input, String mime, long limit) {
        File output = null;
        try (InputStream in = input) {
            String extension = extensionForMime(mime);
            if (extension == null) throw new IOException("Unsupported keyboard image type");
            File dir = temporaryDirectory();
            if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) {
                throw new IOException("Could not create keyboard cache directory");
            }
            output = File.createTempFile("keyboard-", "." + extension, dir);
            long size;
            try (OutputStream out = new FileOutputStream(output)) {
                size = copyBounded(in, out, limit);
            }

            JSObject data = new JSObject();
            data.put("uri", Uri.fromFile(output).toString());
            data.put("name", displayName(source));
            data.put("mime", mime);
            data.put("size", size);
            notifyListeners("image", data);

            // release() normally removes it after the WebView reads it. This is
            // the backstop for an event whose listener disappeared mid-insert.
            File temporary = output;
            executor.schedule(temporary::delete, TEMP_TTL_MINUTES, TimeUnit.MINUTES);
        } catch (TooLargeException e) {
            if (output != null) output.delete();
            emitError("too_large");
        } catch (IOException | RuntimeException e) {
            if (output != null) output.delete();
            emitError("read_failed");
        }
    }

    /** Copies at most maxBytes, rejecting the input rather than truncating it. */
    static long copyBounded(InputStream input, OutputStream output, long maxBytes) throws IOException {
        byte[] buffer = new byte[16 * 1024];
        long total = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            if (read > maxBytes - total) throw new TooLargeException();
            output.write(buffer, 0, read);
            total += read;
        }
        return total;
    }

    static final class TooLargeException extends IOException {}

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(
                uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) {
                    String name = cursor.getString(column);
                    if (name != null && !name.trim().isEmpty()) return name;
                }
            }
        } catch (RuntimeException ignored) {
            // Some keyboard providers expose bytes but no display-name column.
        }
        return "keyboard.gif";
    }

    @PluginMethod
    public void release(PluginCall call) {
        String raw = call.getString("uri");
        if (raw == null) {
            call.reject("uri is required");
            return;
        }
        executor.execute(() -> {
            try {
                File file = new File(Uri.parse(raw).getPath());
                File dir = temporaryDirectory();
                if (file.getCanonicalFile().getParentFile().equals(dir.getCanonicalFile())) {
                    file.delete();
                }
            } catch (IOException | RuntimeException ignored) {
                // Temporary files are also removed by the TTL and at startup.
            }
        });
        call.resolve();
    }

    private File temporaryDirectory() {
        return new File(getContext().getCacheDir(), "keyboard-content");
    }

    private void deleteTemporaryFiles() {
        File[] files = temporaryDirectory().listFiles();
        if (files == null) return;
        for (File file : files) file.delete();
    }

    private void emitError(String code) {
        JSObject data = new JSObject();
        data.put("error", code);
        notifyListeners("image", data);
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
    }
}
