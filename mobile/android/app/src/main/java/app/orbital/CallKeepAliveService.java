package app.orbital;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Foreground service that keeps the app alive while the user is in a voice call.
 *
 * Without it Android freezes the backgrounded process (cached-app freezer) and
 * cuts its network (Doze / App Standby) once the app is minimised or the screen
 * is locked, so the WebView's LiveKit signal socket and our /ws sockets die with
 * code 1006. A foreground service of type "microphone" lifts the process to
 * foreground priority, keeps the mic usable in the background (Android 11+ blocks
 * background mic capture otherwise) and exempts the app from Doze network limits.
 *
 * Started/stopped from JS through CallKeepAlivePlugin (services/platform.ts).
 */
public class CallKeepAliveService extends Service {

    private static final String TAG = "CallKeepAlive";
    static final String EXTRA_TITLE = "title";
    /** Notification buttons; handled in onStartCommand and forwarded to JS. */
    static final String ACTION_TOGGLE_MUTE = "app.orbital.call.TOGGLE_MUTE";
    static final String ACTION_TOGGLE_DEAFEN = "app.orbital.call.TOGGLE_DEAFEN";
    private static final String CHANNEL_ID = "ongoing_call";
    private static final int NOTIFICATION_ID = 4201;

    /** True between a successful startForeground and onDestroy. */
    static volatile boolean running = false;

    /**
     * Mute/deafen state pushed from JS (CallKeepAlivePlugin.update). JS is the
     * source of truth; these only pick the button labels and the status text.
     */
    static volatile boolean muted = false;
    static volatile boolean deafened = false;

    /** The running service, so the plugin can refresh its notification. */
    @Nullable
    private static CallKeepAliveService instance;

    private String title;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_TOGGLE_MUTE.equals(action) || ACTION_TOGGLE_DEAFEN.equals(action)) {
            // A notification button: JS toggles and pushes the new state back (update()).
            if (running) {
                CallKeepAlivePlugin.dispatchAction(ACTION_TOGGLE_MUTE.equals(action) ? "mute" : "deafen");
            } else {
                stopSelf(); // stale button after the call ended
            }
            return START_NOT_STICKY;
        }

        String extraTitle = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        title = extraTitle != null ? extraTitle : getString(R.string.app_name);
        Notification notification = buildNotification();

        if (!enterForeground(notification)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        instance = this;
        acquireLocks();
        // Not sticky: if the system kills us the WebView (and the call) is gone too.
        return START_NOT_STICKY;
    }

    private boolean enterForeground(Notification notification) {
        int type = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
            if (hasMicPermission()) {
                type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            }
        }
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
            return true;
        } catch (SecurityException e) {
            // Microphone type is refused when the app isn't "while-in-use" eligible
            // (Android 14+). Fall back to playback only so listening still survives.
            Log.w(TAG, "microphone FGS type refused, falling back to mediaPlayback", e);
        } catch (RuntimeException e) {
            // ForegroundServiceStartNotAllowedException (Android 12+) when started from background.
            Log.w(TAG, "startForeground failed", e);
            return false;
        }
        try {
            int fallback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, fallback);
            return true;
        } catch (RuntimeException e) {
            Log.w(TAG, "startForeground (mediaPlayback) failed", e);
            return false;
        }
    }

    private boolean hasMicPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** Rebuilds the ongoing notification after a mute/deafen change. */
    static void refresh() {
        CallKeepAliveService service = instance;
        if (service == null || !running) return;
        NotificationManager nm = (NotificationManager) service.getSystemService(Context.NOTIFICATION_SERVICE);
        try {
            nm.notify(NOTIFICATION_ID, service.buildNotification());
        } catch (RuntimeException e) {
            Log.w(TAG, "notification refresh failed", e);
        }
    }

    private PendingIntent actionIntent(String action, int requestCode) {
        Intent intent = new Intent(this, CallKeepAliveService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Ongoing call",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shown while you are connected to a voice channel");
            channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }

        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentIntent = null;
        if (launch != null) {
            launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            contentIntent = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        }

        boolean isMuted = muted;
        boolean isDeafened = deafened;
        String text = isDeafened ? "Deafened" : isMuted ? "Muted" : "Tap to return to the call";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_call_notification)
            .setContentTitle(title)
            .setContentText(text)
            .addAction(
                isMuted ? R.drawable.ic_notif_mic : R.drawable.ic_notif_mic_off,
                isMuted ? "Unmute" : "Mute",
                actionIntent(ACTION_TOGGLE_MUTE, 1)
            )
            .addAction(
                isDeafened ? R.drawable.ic_notif_headphones : R.drawable.ic_notif_headphones_off,
                isDeafened ? "Undeafen" : "Deafen",
                actionIntent(ACTION_TOGGLE_DEAFEN, 2)
            )
            .setOnlyAlertOnce(true)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    private void acquireLocks() {
        // CPU: keep timers/sockets running with the screen off (LiveKit pings, /ws heartbeats).
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "orbital:call");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
        // Wi-Fi: stop the radio from dozing and dropping the connection with the screen off.
        if (wifiLock == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "orbital:call");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
            }
        }
    }

    private void releaseLocks() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        wifiLock = null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // App swiped away from recents: the WebView and the call are gone, drop the notification.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        if (instance == this) instance = null;
        releaseLocks();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
