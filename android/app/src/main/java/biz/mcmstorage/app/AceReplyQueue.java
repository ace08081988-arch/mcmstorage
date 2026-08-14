package biz.mcmstorage.app;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Antrean balasan yang GAGAL terkirim dari notifikasi.
 *
 * Teks pengguna tidak pernah dibuang: disimpan persisten di SharedPreferences
 * bersama action token, lalu dicoba ulang saat proses hidup kembali (FCM
 * berikutnya / aplikasi dibuka). Kegagalan ditampilkan sebagai notifikasi —
 * bukan Toast — karena aksi ini berjalan di latar belakang.
 */
public final class AceReplyQueue {
    private static final String PREF = "ace_reply_queue";
    private static final String KEY = "items";

    private AceReplyQueue() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    public static synchronized void enqueue(Context ctx, String conversationId, String token, String text) {
        try {
            JSONArray arr = read(ctx);
            JSONObject o = new JSONObject();
            o.put("cid", conversationId == null ? "" : conversationId);
            o.put("token", token);
            o.put("text", text);
            o.put("attempts", 0);
            o.put("ts", System.currentTimeMillis());
            arr.put(o);
            // Batasi supaya tidak tumbuh tanpa batas.
            while (arr.length() > 50) arr.remove(0);
            prefs(ctx).edit().putString(KEY, arr.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    /** Coba kirim ulang seluruh antrean. Dipanggil dari thread background. */
    public static synchronized void flush(Context ctx) {
        JSONArray arr = read(ctx);
        if (arr.length() == 0) return;
        JSONArray keep = new JSONArray();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            String token = o.optString("token", "");
            String text = o.optString("text", "");
            int attempts = o.optInt("attempts", 0);
            boolean ok = !token.isEmpty() && !text.isEmpty()
                    && AceNotify.postAction(ctx, token, "reply", text);
            if (!ok && attempts < 8) {
                try {
                    o.put("attempts", attempts + 1);
                } catch (Exception ignored) {
                }
                keep.put(o);
            }
        }
        prefs(ctx).edit().putString(KEY, keep.toString()).apply();
    }

    public static int pending(Context ctx) {
        return read(ctx).length();
    }

    private static JSONArray read(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    /** Notifikasi kegagalan: ditekan → membuka percakapan dengan draft. */
    public static void notifyFailure(Context ctx, String conversationId, int notifId, String text) {
        AceNotify.ensureChannels(ctx);
        String path = conversationId == null || conversationId.isEmpty()
                ? "/chat"
                : "/chat/" + conversationId + "?draft=" + Uri.encode(text);
        Intent open = new Intent(ctx, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(AceMessagingService.deepLink(ctx, path))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(
                ctx, notifId * 10 + 7, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, AceNotify.CH_SYSTEM)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle("Balasan belum terkirim")
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(pi);
        try {
            NotificationManagerCompat.from(ctx).notify(notifId * 10 + 7, b.build());
        } catch (SecurityException ignored) {
        }
    }

    static void cancelFailure(Context ctx, int notifId) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(notifId * 10 + 7);
    }
}
