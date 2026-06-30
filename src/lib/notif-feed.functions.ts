import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FeedItemKind = "chat" | "tugas" | "order" | "system";

export type FeedItem = {
  id: string;
  kind: FeedItemKind;
  title: string;
  body: string;
  createdAt: string;
  href?: string;
  unread?: boolean;
  meta?: Record<string, string | number | null>;
};

/**
 * Ambil daftar notifikasi nyata milik user yang sedang login dari beberapa
 * sumber data eksisting (tidak ada tabel notif tersendiri):
 *   - chat: pesan masuk pada percakapan tempat user jadi anggota, di atas
 *           `last_read_at` user di percakapan tsb.
 *   - tugas: prep_submissions pada task yang dimiliki user.
 *   - system: prep_pin_alerts yang belum di-acknowledge.
 *
 * Semua query memakai klien Supabase ber-RLS milik user — tidak ada akses
 * service role.
 */
export const getRecentNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const items: FeedItem[] = [];

    /* ── Chat: pesan masuk pada percakapan user ───────────────────── */
    const { data: members } = await supabase
      .from("conversation_members")
      .select("conversation_id, last_read_at, archived_at")
      .eq("user_id", userId);
    const convIds = (members ?? []).map((m) => m.conversation_id);
    const lastReadByConv = new Map(
      (members ?? []).map((m) => [m.conversation_id, m.last_read_at as string | null]),
    );
    const archivedByConv = new Map(
      (members ?? []).map((m) => [m.conversation_id, m.archived_at as string | null]),
    );
    if (convIds.length > 0) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, body, attachment_mime, attachment_name, created_at")
        .in("conversation_id", convIds)
        .neq("sender_id", userId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(30);
      for (const m of msgs ?? []) {
        if (archivedByConv.get(m.conversation_id)) continue;
        const lr = lastReadByConv.get(m.conversation_id);
        const unread = !lr || new Date(m.created_at) > new Date(lr);
        const att = m.attachment_mime ?? null;
        const preview = m.body?.trim()
          ? m.body
          : att
            ? att.startsWith("image/")
              ? "📷 Foto"
              : att.startsWith("audio/")
                ? "🎤 Pesan suara"
                : att.startsWith("video/")
                  ? "🎬 Video"
                  : `📎 ${m.attachment_name ?? "Lampiran"}`
            : "(pesan kosong)";
        items.push({
          id: `chat:${m.id}`,
          kind: "chat",
          title: "Pesan baru",
          body: preview.slice(0, 140),
          createdAt: m.created_at,
          href: `/chat/${m.conversation_id}`,
          unread,
        });
      }
    }

    /* ── Tugas: prep_submissions pada task milik user ─────────────── */
    const { data: myTasks } = await supabase
      .from("prep_tasks")
      .select("id, title, share_token")
      .eq("owner_user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50);
    const taskIds = (myTasks ?? []).map((t) => t.id);
    const titleByTask = new Map((myTasks ?? []).map((t) => [t.id, t.title as string]));
    if (taskIds.length > 0) {
      const { data: subs } = await supabase
        .from("prep_submissions")
        .select("id, task_id, qty_reported, submitted_at, photo_paths")
        .in("task_id", taskIds)
        .order("submitted_at", { ascending: false })
        .limit(20);
      for (const s of subs ?? []) {
        const photos = Array.isArray(s.photo_paths) ? s.photo_paths.length : 0;
        items.push({
          id: `tugas:${s.id}`,
          kind: "tugas",
          title: "Pegawai mengirim penyiapan",
          body: `${titleByTask.get(s.task_id) ?? "Tugas"} · ${s.qty_reported ?? 0} item${photos ? ` · ${photos} foto` : ""}`,
          createdAt: s.submitted_at,
          href: `/tugas`,
        });
      }
    }

    /* ── Sistem: prep_pin_alerts belum di-ack ─────────────────────── */
    const { data: alerts } = await supabase
      .from("prep_pin_alerts")
      .select("id, task_id, failure_count, window_start, window_end, created_at, acknowledged_at")
      .eq("owner_user_id", userId)
      .is("acknowledged_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const a of alerts ?? []) {
      items.push({
        id: `system:${a.id}`,
        kind: "system",
        title: "Peringatan PIN pegawai",
        body: `${a.failure_count}× percobaan PIN gagal · ${titleByTask.get(a.task_id) ?? "tugas pegawai"}`,
        createdAt: a.created_at,
        href: `/tugas`,
        unread: true,
      });
    }

    /* ── Order: event status pesanan terbaru ──────────────────────── */
    const { data: events } = await supabase
      .from("order_request_events")
      .select("id, order_id, from_status, to_status, note, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    for (const e of events ?? []) {
      items.push({
        id: `order:${e.id}`,
        kind: "order",
        title: "Pesanan diperbarui",
        body: `${e.from_status ?? "—"} → ${e.to_status}${e.note ? ` · ${e.note}` : ""}`,
        createdAt: e.created_at,
        href: `/pesanan`,
      });
    }

    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { items: items.slice(0, 40), generatedAt: new Date().toISOString() };
  });

/**
 * Tandai satu item notifikasi sebagai sudah dibaca.
 *   - chat:<messageId>  → set conversation_members.last_read_at ≥ message.created_at
 *   - system:<alertId>  → set prep_pin_alerts.acknowledged_at = now()
 *   - tugas/order       → no server-side read state (akan ditangani di klien)
 */
export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!data || typeof data.id !== "string" || !data.id.includes(":")) {
      throw new Error("invalid_id");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [kind, rawId] = data.id.split(":", 2);
    if (kind === "chat") {
      const { data: msg } = await supabase
        .from("messages")
        .select("conversation_id, created_at")
        .eq("id", rawId)
        .maybeSingle();
      if (!msg) return { ok: false, reason: "message_not_found" as const };
      const { data: member } = await supabase
        .from("conversation_members")
        .select("last_read_at")
        .eq("conversation_id", msg.conversation_id)
        .eq("user_id", userId)
        .maybeSingle();
      const next = msg.created_at as string;
      if (member?.last_read_at && new Date(member.last_read_at) >= new Date(next)) {
        return { ok: true, skipped: true as const };
      }
      const { error } = await supabase
        .from("conversation_members")
        .update({ last_read_at: next })
        .eq("conversation_id", msg.conversation_id)
        .eq("user_id", userId);
      if (error) throw error;
      return { ok: true };
    }
    if (kind === "system") {
      const { error } = await supabase
        .from("prep_pin_alerts")
        .update({ acknowledged_at: new Date().toISOString() })
        .eq("id", rawId)
        .eq("owner_user_id", userId)
        .is("acknowledged_at", null);
      if (error) throw error;
      return { ok: true };
    }
    return { ok: true, skipped: true as const };
  });

/** Tandai semua percakapan dibaca + acknowledge semua peringatan PIN. */
export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();
    const [c, s] = await Promise.all([
      supabase
        .from("conversation_members")
        .update({ last_read_at: nowIso })
        .eq("user_id", userId)
        .is("archived_at", null),
      supabase
        .from("prep_pin_alerts")
        .update({ acknowledged_at: nowIso })
        .eq("owner_user_id", userId)
        .is("acknowledged_at", null),
    ]);
    if (c.error) throw c.error;
    if (s.error) throw s.error;
    return { ok: true };
  });