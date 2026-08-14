package biz.mcmstorage.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Helper notifikasi MCM Storage: channel stabil + pemanggilan endpoint aksi.
 *
 * ID channel WAJIB sama persis dengan `src/lib/local-notify.ts`
 * (NOTIF_CHANNELS) dan `FCM_CHANNELS` di `src/lib/fcm.server.ts`, kalau
 * tidak notifikasi web-layer dan native-layer akan memakai channel berbeda
 * dan pengaturan suara/getar pengguna terpecah dua.
 */
public final class AceNotify {
    private AceNotify() {}

    public static final String TAG = "AceNotify";

    public static final String CH_CHAT = "mcm_chat";
    public static final String CH_CALL = "mcm_call";
    public static final String CH_TUGAS = "mcm_tugas";
    public static final String CH_ORDER = "mcm_order";
    public static final String CH_SYSTEM = "mcm_system";

    public static final String ACTION_REPLY = "biz.mcmstorage.app.REPLY";
    public static final String ACTION_MARK_READ = "biz.mcmstorage.app.MARK_READ";

    public static final String KEY_REPLY_TEXT = "ace_reply_text";

    public static final String EX_TOKEN = "token";
    public static final String EX_CONVERSATION = "conversationId";
    public static final String EX_NOTIF_ID = "notifId";
    public static final String EX_URL = "url";

    /** Buat semua channel sekali (idempotent — Android mengabaikan duplikat). */
    public static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        create(nm, CH_CHAT, "Pesan chat", "Pesan masuk dari pelanggan, supplier, dan pegawai",
                NotificationManager.IMPORTANCE_HIGH, false);
        // Panggilan internal berjalan di dalam aplikasi (WebRTC di WebView);
        // channel ini hanya untuk pemberitahuan biasa, tanpa full-screen intent.
        create(nm, CH_CALL, "Panggilan", "Pemberitahuan panggilan suara dan video",
                NotificationManager.IMPORTANCE_HIGH, true);
        create(nm, CH_TUGAS, "Penyiapan & tugas", "Pegawai mengunggah penyiapan, tugas selesai atau gagal",
                NotificationManager.IMPORTANCE_DEFAULT, false);
        create(nm, CH_ORDER, "Pesanan", "Pesanan baru dan perubahan status",
                NotificationManager.IMPORTANCE_DEFAULT, false);
        create(nm, CH_SYSTEM, "Sistem", "Pemberitahuan aplikasi",
                NotificationManager.IMPORTANCE_DEFAULT, false);
    }

    private static void create(NotificationManager nm, String id, String name, String desc,
                               int importance, boolean ringtone) {
        NotificationChannel ch = new NotificationChannel(id, name, importance);
        ch.setDescription(desc);
        ch.enableVibration(true);
        ch.enableLights(true);
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        if (ringtone) {
            ch.setVibrationPattern(new long[] {0, 500, 400, 500, 400, 500});
            Uri ring = android.media.RingtoneManager
                    .getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE);
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            ch.setSound(ring, attrs);
        }
        nm.createNotificationChannel(ch);
    }

    /** Base URL server (dipakai endpoint aksi notifikasi). */
    public static String apiBase(Context ctx) {
        String v = ctx.getString(R.string.ace_api_base);
        if (v == null || v.trim().isEmpty()) return "https://mcmstorage.app";
        return v.trim().replaceAll("/+$", "");
    }

    /**
     * POST ke /api/public/chat-action.
     *
     * `token` adalah action token HMAC berumur pendek & sekali-pakai yang
     * dikirim di payload FCM — APK tidak pernah menyimpan secret apa pun.
     * Mengembalikan true bila server menerima aksi.
     */
    public static boolean postAction(Context ctx, String token, String action, String text) {
        HttpURLConnection conn = null;
        try {
            JSONObject body = new JSONObject();
            body.put("token", token);
            body.put("action", action);
            if (text != null && !text.isEmpty()) body.put("text", text);

            URL url = new URL(apiBase(ctx) + "/api/public/chat-action");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
            }
            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) return true;
            Log.w(TAG, "aksi " + action + " gagal: HTTP " + code);
            return false;
        } catch (Exception e) {
            Log.w(TAG, "aksi " + action + " error", e);
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}