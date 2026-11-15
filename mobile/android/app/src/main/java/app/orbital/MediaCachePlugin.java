package app.orbital;

import androidx.annotation.Nullable;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge for MediaCache (see services/platform.ts mediaCacheNative).
 * Local app plugin, registered in MainActivity; no npm package involved.
 */
@CapacitorPlugin(name = "MediaCache")
public class MediaCachePlugin extends Plugin {

    /** Loaded plugin instance; MediaCache forwards its log lines through it. */
    @Nullable
    private static volatile MediaCachePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /**
     * Emits a native log line as the JS "log" event (relayed into the app's debug
     * log). Retained until a listener is attached, so startup lines aren't lost.
     */
    static void emitLog(String level, String message) {
        MediaCachePlugin plugin = instance;
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("level", level);
        data.put("message", message);
        plugin.notifyListeners("log", data, true);
    }

    private MediaCache cache() {
        return MediaCache.get(getContext());
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("keys", new JSArray(cache().keys()));
        call.resolve(ret);
        // JS lists on chat open and after misses: a good moment to have S3 ready.
        cache().warm();
    }

    @PluginMethod
    public void evict(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("id is required");
            return;
        }
        cache().evict(id);
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        cache().clear();
        call.resolve();
    }
}
