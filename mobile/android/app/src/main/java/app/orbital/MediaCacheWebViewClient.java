package app.orbital;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Capacitor's WebView client plus the chat media cache: requests to
 * &lt;app origin&gt;/_media/&lt;key&gt; are answered by MediaCache, everything else goes
 * to Capacitor as before. Installed in MainActivity.
 */
public class MediaCacheWebViewClient extends BridgeWebViewClient {

    private static final String PREFIX = "/_media/";

    private final Bridge bridge;

    public MediaCacheWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        if (
            path != null &&
            path.startsWith(PREFIX) &&
            "GET".equalsIgnoreCase(request.getMethod()) &&
            bridge.getHost().equals(url.getHost())
        ) {
            String key = path.substring(PREFIX.length());
            if (!MediaCache.KEY_PATTERN.matcher(key).matches()) {
                MediaCache.log("warn", "Rejected media key " + key);
                return super.shouldInterceptRequest(view, request);
            }
            try {
                return MediaCache.get(bridge.getContext()).serve(key, url.getQueryParameter("src"), request.getRequestHeaders());
            } catch (Throwable t) {
                // Anything escaping here reaches the page only as net::ERR_FAILED.
                MediaCache.log("error", "Intercepting " + key + " crashed", t);
                throw t;
            }
        }
        return super.shouldInterceptRequest(view, request);
    }
}
