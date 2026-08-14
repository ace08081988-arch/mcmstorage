package biz.mcmstorage.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Aksi dari notifikasi: Balas (RemoteInput), Tandai dibaca, Tolak panggilan.
 *
 * Semua dieksekusi TANPA membuka aplikasi dan tanpa sesi Supabase di device:
 * autentikasi memakai action token HMAC sekali-pakai dari payload FCM.
 */
public class AceActionReceiver extends BroadcastReceiver {

    /** Satu executor untuk seluruh proses — jangan buat baru tiap aksi. */
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        final Context ctx = context.getApplicationContext();
        final String token = intent.getStringExtra(AceNotify.EX_TOKEN);
        final String conversationId = intent.getStringExtra(AceNotify.EX_CONVERSATION);
        final int notifId = intent.getIntExtra(AceNotify.EX_NOTIF_ID, 0);

        if ("biz.mcmstorage.app.DISMISS".equals(action)) {
            if (conversationId != null) AceChatStore.clear(ctx, conversationId);
            return;
        }

        if (AceNotify.ACTION_REPLY.equals(action)) {
            Bundle remote = RemoteInput.getResultsFromIntent(intent);
            CharSequence text = remote == null ? null : remote.getCharSequence(AceNotify.KEY_REPLY_TEXT);
            final String reply = text == null ? "" : text.toString().trim();
            if (reply.isEmpty() || token == null) return;
            // Optimistis: tampilkan balasan di notifikasi supaya terasa instan.
            appendOwnReply(ctx, conversationId, notifId, reply);
            run(ctx, () -> {
                boolean ok = AceNotify.postAction(ctx, token, "reply", reply);
                if (ok) {
                    if (conversationId != null) AceChatStore.clear(ctx, conversationId);
                    cancel(ctx, notifId);
                } else {
                    // Jangan buang teks pengguna: simpan di antrean lokal dan
                    // beri notifikasi kegagalan yang bisa ditekan untuk membuka
                    // percakapan dengan draft.
                    AceReplyQueue.enqueue(ctx, conversationId, token, reply);
                    AceReplyQueue.notifyFailure(ctx, conversationId, notifId, reply);
                }
            });
            return;
        }

        if (AceNotify.ACTION_MARK_READ.equals(action)) {
            if (token == null) return;
            // Notifikasi baru dihapus SETELAH server menerima — kalau gagal,
            // pesan tetap terlihat belum dibaca.
            run(ctx, () -> {
                if (AceNotify.postAction(ctx, token, "mark-read", null)) {
                    if (conversationId != null) AceChatStore.clear(ctx, conversationId);
                    cancel(ctx, notifId);
                } else {
                    toast(ctx, "Gagal menandai dibaca — coba lagi dari aplikasi");
                }
            });
            return;
        }

        if (AceNotify.ACTION_CALL_DECLINE.equals(action)) {
            cancel(ctx, notifId);
            CallForegroundService.stop(ctx);
            if (token != null && !token.isEmpty()) {
                run(ctx, () -> AceNotify.postAction(ctx, token, "call-decline", null));
            }
        }
    }

    private void appendOwnReply(Context ctx, String conversationId, int notifId, String reply) {
        if (conversationId == null || conversationId.isEmpty()) return;
        List<AceChatStore.Item> items =
                AceChatStore.append(ctx, conversationId, "Saya", reply, System.currentTimeMillis());
        Person me = new Person.Builder().setName("Saya").setKey("me").build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(me);
        for (AceChatStore.Item it : items) {
            Person from = "Saya".equals(it.sender)
                    ? null
                    : new Person.Builder().setName(it.sender).setKey(it.sender).build();
            style.addMessage(it.text, it.ts, from);
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, AceNotify.CH_CHAT)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setStyle(style)
                .setOnlyAlertOnce(true)
                .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(ctx).notify(notifId, b.build());
        } catch (SecurityException ignored) {
        }
    }

    private static void cancel(Context ctx, int notifId) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(notifId);
    }

    private static void toast(Context ctx, String msg) {
        new Handler(Looper.getMainLooper()).post(
                () -> Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show());
    }

    private void run(Context ctx, Runnable task) {
        final PendingResult pending = goAsync();
        IO.execute(() -> {
            try {
                task.run();
            } finally {
                pending.finish();
            }
        });
    }
}