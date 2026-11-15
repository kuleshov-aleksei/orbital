package app.orbital;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before super.onCreate builds the bridge.
        registerPlugin(CallKeepAlivePlugin.class);
        registerPlugin(MediaCachePlugin.class);
        registerPlugin(OtaBundlePlugin.class);
        super.onCreate(savedInstanceState);
        // Serves /_media/ (chat media cache) in front of Capacitor's own handling.
        getBridge().setWebViewClient(new MediaCacheWebViewClient(getBridge()));
    }
}
