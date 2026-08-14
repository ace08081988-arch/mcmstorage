package biz.mcmstorage.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Foreground service HANYA selama panggilan berlangsung.
 *
 * Tujuannya menjaga proses tetap hidup saat panggilan aktif (WebRTC berjalan
 * di WebView) tanpa menahan baterai di luar panggilan — service dihentikan
 * begitu panggilan ditolak, berakhir, atau timeout.
 */
public class CallForegroundService extends Service {
    private static final int NOTIF_ID = 424242;
    private static final String EX_NAME = "peerName";
    private static final String EX_KIND = "callKind";

    public static void start(Context ctx, String peerName, String callKind) {
        try {
            Intent i = new Intent(ctx, CallForegroundService.class)
                    .putExtra(EX_NAME, peerName)
                    .putExtra(EX_KIND, callKind);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Exception ignored) {
            // Batasan background-start: panggilan tetap jalan lewat activity.
        }
    }

    public static void stop(Context ctx) {
        try {
            ctx.stopService(new Intent(ctx, CallForegroundService.class));
        } catch (Exception ignored) {
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        AceNotify.ensureChannels(this);
        String name = intent == null ? "" : String.valueOf(intent.getStringExtra(EX_NAME));
        String kind = intent == null ? "audio" : String.valueOf(intent.getStringExtra(EX_KIND));
        Intent open = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(AceMessagingService.deepLink("/chat"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification n = new NotificationCompat.Builder(this, AceNotify.CH_CALL)
                .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                .setContentTitle("Panggilan " + ("video".equals(kind) ? "video" : "suara") + " aktif")
                .setContentText(name == null || name.isEmpty() ? "Ace Chat" : name)
                .setOngoing(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setContentIntent(pi)
                .build();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}