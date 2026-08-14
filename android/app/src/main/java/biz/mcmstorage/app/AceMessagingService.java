package biz.mcmstorage.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.List;
import java.util.Map;

/**
 * Penerima FCM data-only untuk Ace Chat.
 *
 * Server SELALU mengirim data message HIGH priority (lihat
 * `src/lib/fcm.server.ts`) karena notifikasi otomatis Android tidak bisa
 * punya tombol Balas, MessagingStyle, bubble, atau CallStyle. Semua UI
 * notifikasi dibangun di sini, jadi pesan tetap masuk saat aplikasi
 * background, di-swipe, atau layar terkunci.
 */
public class AceMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(String token) {
        // Registrasi token ke server dilakukan lapisan web saat app hidup
        // (`src/lib/native-push.ts`). Di sini cukup catat supaya token lama
        // tidak dipakai diam-diam.
        Log.i(AceNotify.TAG, "FCM token baru diterima");
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> d = message.getData();
        if (d == null || d.isEmpty()) return;
        AceNotify.ensureChannels(this);

        String kind = value(d, "kind", "system");
        if ("call".equals(kind)) {
            showCall(d);
            return;
        }
        if ("chat".equals(kind)) {
            showChat(d);
            return;
        }
        showGeneric(d, kind);
    }

    // ── Chat: MessagingStyle + Balas + Tandai dibaca + bubble ──────────
    private void showChat(Map<String, String> d) {
        String conversationId = value(d, "conversationId", "");
        if (conversationId.isEmpty()) {
            showGeneric(d, "chat");
            return;
        }
        String title = value(d, "title", "Pesan baru");
        String body = value(d, "body", "");
        String senderName = value(d, "senderName", title);
        String url = value(d, "url", "/chat/" + conversationId);
        String replyToken = d.get("replyToken");
        String markReadToken = d.get("markReadToken");
        int notifId = AceChatStore.notifId(conversationId);

        List<AceChatStore.Item> items =
                AceChatStore.append(this, conversationId, senderName, body, System.currentTimeMillis());

        Person me = new Person.Builder().setName("Saya").setKey("me").build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(me);
        style.setConversationTitle(title.equals(senderName) ? null : title);
        style.setGroupConversation(!title.equals(senderName));
        for (AceChatStore.Item it : items) {
            Person from = "Saya".equals(it.sender)
                    ? null
                    : new Person.Builder().setName(it.sender).setKey(it.sender).build();
            style.addMessage(it.text, it.ts, from);
        }

        String shortcutId = ensureShortcut(conversationId, title, url);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, AceNotify.CH_CHAT)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setStyle(style)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                .setContentIntent(openIntent(conversationId, url, notifId))
                .setDeleteIntent(dismissIntent(conversationId, notifId));

        if (shortcutId != null) {
            b.setShortcutId(shortcutId);
            b.setLocusId(new androidx.core.content.LocusIdCompat(shortcutId));
            NotificationCompat.BubbleMetadata bubble = bubbleMetadata(conversationId, url);
            if (bubble != null) b.setBubbleMetadata(bubble);
        }

        if (replyToken != null && !replyToken.isEmpty()) {
            RemoteInput remoteInput = new RemoteInput.Builder(AceNotify.KEY_REPLY_TEXT)
                    .setLabel("Balas…")
                    .build();
            Intent replyIntent = actionIntent(AceNotify.ACTION_REPLY, conversationId, notifId)
                    .putExtra(AceNotify.EX_TOKEN, replyToken);
            PendingIntent replyPi = PendingIntent.getBroadcast(
                    this, notifId * 10 + 1, replyIntent, mutableFlags());
            b.addAction(new NotificationCompat.Action.Builder(
                    android.R.drawable.ic_menu_send, "Balas", replyPi)
                    .addRemoteInput(remoteInput)
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                    .setAllowGeneratedReplies(true)
                    .setShowsUserInterface(false)
                    .build());
        }
        if (markReadToken != null && !markReadToken.isEmpty()) {
            Intent readIntent = actionIntent(AceNotify.ACTION_MARK_READ, conversationId, notifId)
                    .putExtra(AceNotify.EX_TOKEN, markReadToken);
            PendingIntent readPi = PendingIntent.getBroadcast(
                    this, notifId * 10 + 2, readIntent, immutableFlags());
            b.addAction(new NotificationCompat.Action.Builder(
                    android.R.drawable.ic_menu_view, "Tandai dibaca", readPi)
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
                    .setShowsUserInterface(false)
                    .build());
        }

        notify(notifId, b.build());
    }

    // ── Panggilan: CallStyle + full-screen intent ──────────────────────
    private void showCall(Map<String, String> d) {
        String callId = value(d, "callId", "");
        String conversationId = value(d, "conversationId", "");
        String callerName = value(d, "callerName", value(d, "title", "Panggilan masuk"));
        String callKind = value(d, "callKind", "audio");
        String declineToken = value(d, "declineToken", "");
        if (callId.isEmpty()) {
            showGeneric(d, "system");
            return;
        }
        int notifId = Math.abs(("call:" + callId).hashCode());

        Intent full = new Intent(this, IncomingCallActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(AceNotify.EX_CALL_ID, callId)
                .putExtra(AceNotify.EX_CONVERSATION, conversationId)
                .putExtra(AceNotify.EX_CALL_KIND, callKind)
                .putExtra(AceNotify.EX_CALLER, callerName)
                .putExtra(AceNotify.EX_TOKEN, declineToken)
                .putExtra(AceNotify.EX_NOTIF_ID, notifId);
        PendingIntent fullPi = PendingIntent.getActivity(this, notifId, full, immutableFlags());

        Intent acceptIntent = new Intent(this, IncomingCallActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtras(full)
                .putExtra("autoAccept", true);
        PendingIntent acceptPi = PendingIntent.getActivity(
                this, notifId * 10 + 3, acceptIntent, immutableFlags());

        Intent declineIntent = actionIntent(AceNotify.ACTION_CALL_DECLINE, conversationId, notifId)
                .putExtra(AceNotify.EX_TOKEN, declineToken)
                .putExtra(AceNotify.EX_CALL_ID, callId);
        PendingIntent declinePi = PendingIntent.getBroadcast(
                this, notifId * 10 + 4, declineIntent, immutableFlags());

        Person caller = new Person.Builder().setName(callerName).setImportant(true).build();
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, AceNotify.CH_CALL)
                .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setTimeoutAfter(35000)
                .setFullScreenIntent(fullPi, true)
                .setContentIntent(fullPi);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            b.setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, declinePi, acceptPi));
        } else {
            b.setContentTitle("Panggilan " + ("video".equals(callKind) ? "video" : "suara") + " masuk")
                    .setContentText(callerName + " sedang memanggil…")
                    .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Tolak", declinePi)
                    .addAction(android.R.drawable.ic_menu_call, "Jawab", acceptPi);
        }
        notify(notifId, b.build());
    }

    private void showGeneric(Map<String, String> d, String kind) {
        String channel = channelFor(kind);
        String title = value(d, "title", "Ace Storage");
        String body = value(d, "body", "");
        String url = value(d, "url", "/");
        int notifId = Math.abs((value(d, "tag", title + body)).hashCode());
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, channel)
                .setSmallIcon(android.R.drawable.stat_notify_more)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(openIntent(null, url, notifId));
        notify(notifId, b.build());
    }

    // ── util ───────────────────────────────────────────────────────────
    private void notify(int id, Notification n) {
        try {
            NotificationManagerCompat.from(this).notify(id, n);
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS belum diberikan (Android 13+).
            Log.w(AceNotify.TAG, "notifikasi ditolak: izin belum diberikan");
        }
    }

    static String channelFor(String kind) {
        if ("chat".equals(kind)) return AceNotify.CH_CHAT;
        if ("call".equals(kind)) return AceNotify.CH_CALL;
        if ("tugas".equals(kind)) return AceNotify.CH_TUGAS;
        if ("order".equals(kind)) return AceNotify.CH_ORDER;
        return AceNotify.CH_SYSTEM;
    }

    static Uri deepLink(String path) {
        String p = path == null || path.isEmpty() ? "/" : path;
        if (p.startsWith("http")) return Uri.parse(p);
        if (!p.startsWith("/")) p = "/" + p;
        return Uri.parse("biz.mcmstorage.app:/" + p);
    }

    private PendingIntent openIntent(String conversationId, String url, int notifId) {
        Intent i = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(deepLink(url))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (conversationId != null) i.putExtra(AceNotify.EX_CONVERSATION, conversationId);
        return PendingIntent.getActivity(this, notifId, i, immutableFlags());
    }

    private PendingIntent dismissIntent(String conversationId, int notifId) {
        Intent i = actionIntent("biz.mcmstorage.app.DISMISS", conversationId, notifId);
        return PendingIntent.getBroadcast(this, notifId * 10 + 5, i, immutableFlags());
    }

    private Intent actionIntent(String action, String conversationId, int notifId) {
        return new Intent(this, AceActionReceiver.class)
                .setAction(action)
                .putExtra(AceNotify.EX_CONVERSATION, conversationId == null ? "" : conversationId)
                .putExtra(AceNotify.EX_NOTIF_ID, notifId);
    }

    private static int immutableFlags() {
        return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    }

    private static int mutableFlags() {
        // RemoteInput WAJIB mutable — sistem menyisipkan teks balasan.
        return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE;
    }

    /** Shortcut dinamis: syarat MessagingStyle bubble & conversation section. */
    private String ensureShortcut(String conversationId, String title, String url) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null;
        try {
            ShortcutManager sm = getSystemService(ShortcutManager.class);
            if (sm == null) return null;
            String id = "conv_" + conversationId;
            Intent target = new Intent(this, MainActivity.class)
                    .setAction(Intent.ACTION_VIEW)
                    .setData(deepLink(url));
            ShortcutInfo info = new ShortcutInfo.Builder(this, id)
                    .setShortLabel(title)
                    .setLongLabel(title)
                    .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
                    .setIntent(target)
                    .setLongLived(true)
                    .setCategories(java.util.Collections.singleton(
                            "android.shortcut.conversation"))
                    .build();
            sm.pushDynamicShortcut(info);
            return id;
        } catch (Exception e) {
            Log.w(AceNotify.TAG, "shortcut gagal", e);
            return null;
        }
    }

    private NotificationCompat.BubbleMetadata bubbleMetadata(String conversationId, String url) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null;
        try {
            Intent i = new Intent(this, ChatBubbleActivity.class)
                    .setAction(Intent.ACTION_VIEW)
                    .setData(deepLink(url))
                    .putExtra(AceNotify.EX_CONVERSATION, conversationId);
            PendingIntent pi = PendingIntent.getActivity(
                    this, AceChatStore.notifId(conversationId) * 10 + 6, i, immutableFlags());
            return new NotificationCompat.BubbleMetadata.Builder(
                    pi, androidx.core.graphics.drawable.IconCompat.createWithResource(
                            this, R.mipmap.ic_launcher))
                    .setDesiredHeight(640)
                    .setAutoExpandBubble(false)
                    .setSuppressNotification(false)
                    .build();
        } catch (Exception e) {
            return null;
        }
    }

    private static String value(Map<String, String> d, String key, String fallback) {
        String v = d.get(key);
        return v == null || v.isEmpty() ? fallback : v;
    }
}