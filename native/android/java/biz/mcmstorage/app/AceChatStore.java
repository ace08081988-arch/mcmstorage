package biz.mcmstorage.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Riwayat pesan singkat per percakapan untuk MessagingStyle.
 *
 * Disimpan di SharedPreferences (bukan memori) supaya notifikasi tetap
 * menumpuk dengan benar setelah proses aplikasi dimatikan sistem /
 * di-swipe — inilah alasan pesan ke-2 dst tetap terlihat sebagai
 * percakapan, bukan notifikasi terpisah tanpa konteks.
 */
public final class AceChatStore {
    private static final String PREF = "ace_chat_notif";
    private static final int MAX = 8;

    public static final class Item {
        public final String sender;
        public final String text;
        public final long ts;

        Item(String sender, String text, long ts) {
            this.sender = sender;
            this.text = text;
            this.ts = ts;
        }
    }

    private AceChatStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    public static synchronized List<Item> append(Context ctx, String conversationId,
                                                 String sender, String text, long ts) {
        List<Item> items = read(ctx, conversationId);
        items.add(new Item(sender, text, ts));
        while (items.size() > MAX) items.remove(0);
        JSONArray arr = new JSONArray();
        for (Item it : items) {
            try {
                JSONObject o = new JSONObject();
                o.put("s", it.sender == null ? "" : it.sender);
                o.put("t", it.text == null ? "" : it.text);
                o.put("ts", it.ts);
                arr.put(o);
            } catch (Exception ignored) {
            }
        }
        prefs(ctx).edit().putString(conversationId, arr.toString()).apply();
        return items;
    }

    public static synchronized List<Item> read(Context ctx, String conversationId) {
        List<Item> out = new ArrayList<>();
        String raw = prefs(ctx).getString(conversationId, null);
        if (raw == null) return out;
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                out.add(new Item(o.optString("s"), o.optString("t"), o.optLong("ts")));
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    public static synchronized void clear(Context ctx, String conversationId) {
        prefs(ctx).edit().remove(conversationId).apply();
    }

    /** ID notifikasi stabil per percakapan (satu notifikasi per chat). */
    public static int notifId(String conversationId) {
        return Math.abs(("conv:" + conversationId).hashCode());
    }
}