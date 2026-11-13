package app.orbital;

import android.content.Intent;
import androidx.core.content.ContextCompat;
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
        intent.putExtra(CallKeepAliveService.EXTRA_TEXT, call.getString("text"));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("Could not start call service: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopService();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        stopService();
    }

    private void stopService() {
        // Clear now, not in onDestroy: a room switch calls stop() then start() right
        // away, and start() must not be skipped as "already running".
        CallKeepAliveService.running = false;
        getContext().stopService(new Intent(getContext(), CallKeepAliveService.class));
    }
}
