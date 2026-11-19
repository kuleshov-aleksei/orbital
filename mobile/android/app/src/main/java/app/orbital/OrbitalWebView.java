package app.orbital;

import android.content.Context;
import android.util.AttributeSet;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import androidx.core.view.ViewCompat;
import androidx.core.view.inputmethod.EditorInfoCompat;
import androidx.core.view.inputmethod.InputConnectionCompat;
import com.getcapacitor.CapacitorWebView;

/** Capacitor WebView with Android's rich-keyboard-content contract wired up. */
public class OrbitalWebView extends CapacitorWebView {

    public OrbitalWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
        InputConnection inputConnection = super.onCreateInputConnection(outAttrs);
        if (inputConnection == null) return null;

        // Setting OnReceiveContentListener alone is not enough for a WebView:
        // Gboard checks these MIME types before it enables GIF insertion, and
        // the wrapper dispatches commitContent() to that listener.
        String[] mimeTypes = ViewCompat.getOnReceiveContentMimeTypes(this);
        if (mimeTypes != null) {
            EditorInfoCompat.setContentMimeTypes(outAttrs, mimeTypes);
            return InputConnectionCompat.createWrapper(this, inputConnection, outAttrs);
        }
        return inputConnection;
    }
}
