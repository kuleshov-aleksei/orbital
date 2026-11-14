package app.orbital;

import android.content.Intent;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge for CallKeepAliveService (see services/platform.ts setCallKeepAlive).
 * Local app plugin, registered in MainActivity; no npm package involved.
 */
@CapacitorPlugin(name = "CallKeepAlive")
public class CallKeepAlivePlugin extends Plugin {

    /** Loaded plugin instance; the service forwards notification button taps through it. */
    @Nullable
    private static volatile CallKeepAlivePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Emits a notification button tap ("mute" / "deafen") as the JS "action" event. */
    static void dispatchAction(String action) {
        CallKeepAlivePlugin plugin = instance;
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        plugin.notifyListeners("action", data);
    }

    private static void readState(PluginCall call) {
        CallKeepAliveService.muted = Boolean.TRUE.equals(call.getBoolean("muted", CallKeepAliveService.muted));
        CallKeepAliveService.deafened = Boolean.TRUE.equals(call.getBoolean("deafened", CallKeepAliveService.deafened));
    }

    @PluginMethod
    public void start(PluginCall call) {
        // Idempotent: supervisor rejoins can call this while the app is in the
        // background, where Android 12+ forbids starting a foreground service.
        if (CallKeepAliveService.running) {
            call.resolve();
            return;
        }
        Intent intent = new Intent(getContext(), CallKeepAliveService.class);
        intent.putExtra(CallKeepAliveService.EXTRA_TITLE, call.getString("title"));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("Could not start call service: " + e.getMessage(), e);
        }
    }

    /** Mute/deafen changed in JS: update the notification buttons and text. */
    @PluginMethod
    public void update(PluginCall call) {
        readState(call);
        CallKeepAliveService.refresh();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopService();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        stopService();
    }

    private void stopService() {
        // Clear now, not in onDestroy: a room switch calls stop() then start() right
        // away, and start() must not be skipped as "already running".
        CallKeepAliveService.running = false;
        getContext().stopService(new Intent(getContext(), CallKeepAliveService.class));
    }
}
