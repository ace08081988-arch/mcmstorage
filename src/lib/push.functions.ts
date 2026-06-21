import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const registerSchema = z.object({
  endpoint: z.string().url().max(2048),
  p256dh: z.string().min(10).max(512),
  auth: z.string().min(10).max(512),
  userAgent: z.string().max(512).optional().nullable(),
});

export const registerPushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => registerSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: userId,
          endpoint: data.endpoint,
          p256dh: data.p256dh,
          auth: data.auth,
          user_agent: data.userAgent ?? null,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unregisterPushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ endpoint: z.string().url() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const dispatchSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  url: z.string().max(512).optional(),
  tag: z.string().max(120).optional(),
  conversationId: z.string().uuid().optional(),
});

/**
 * Dispatch push notifications to a list of users.
 * Uses service-role to read subscriptions and prune dead endpoints (404/410).
 */
export const dispatchPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => dispatchSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { notifyUsers } = await import("./push.server");
    return notifyUsers({
      userIds: data.userIds,
      excludeUserId: context.userId,
      payload: {
        title: data.title,
        body: data.body,
        url: data.url ?? (data.conversationId ? `/chat/${data.conversationId}` : "/chat"),
        tag: data.tag ?? (data.conversationId ? `conv:${data.conversationId}` : undefined),
        conversationId: data.conversationId,
      },
    });
  });

/** Self-test: send a push to the caller's own subscriptions. */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWebPush } = await import("./push.server");
    const { data: subs, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    if (!subs || subs.length === 0) return { sent: 0, message: "Belum ada langganan push" };
    const payload = {
      title: "Uji notifikasi chat",
      body: "Notifikasi push berhasil terkirim ke perangkat ini.",
      url: "/chat",
      tag: "self-test",
    };
    let sent = 0;
    for (const s of subs) {
      const r = await sendWebPush(s, payload);
      if (r.ok) sent++;
    }
    return { sent, message: sent > 0 ? `Terkirim ke ${sent} perangkat` : "Gagal kirim" };
  });

const testContactSchema = z.object({
  kind: z.enum(["customer", "supplier"]),
  id: z.string().uuid(),
});

/** Send a test push to the user account linked to a customer/supplier the caller owns. */
export const sendTestPushToContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => testContactSchema.parse(data))
  .handler(async ({ data, context }) => {
    const table = data.kind === "customer" ? "customers" : "suppliers";
    // RLS scopes to caller's rows, so this implicitly authorizes ownership.
    const { data: row, error } = await context.supabase
      .from(table)
      .select("id, name, account_user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Kontak tidak ditemukan");
    if (!row.account_user_id) {
      return { sent: 0, message: "Kontak belum tertaut ke akun pengguna" };
    }
    const { notifyUsers } = await import("./push.server");
    const result = await notifyUsers({
      userIds: [row.account_user_id],
      payload: {
        title: "Uji notifikasi dari MCM Storage",
        body: `Halo ${row.name}, ini notifikasi uji dari akun yang menautkan Anda.`,
        url: "/chat",
        tag: `test-contact:${row.id}`,
      },
    });
    return {
      sent: result.sent,
      message:
        result.sent > 0
          ? `Terkirim ke ${result.sent} perangkat`
          : "Pengguna belum mengaktifkan notifikasi di perangkatnya",
    };
  });

const testAllSchema = z.object({
  kind: z.enum(["customer", "supplier", "all"]).default("all"),
});

/** Send a test push to every linked account across the caller's contacts. */
export const sendTestPushToAllContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => testAllSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    const tables: ("customers" | "suppliers")[] =
      data.kind === "all"
        ? ["customers", "suppliers"]
        : [data.kind === "customer" ? "customers" : "suppliers"];
    const userIds = new Set<string>();
    for (const t of tables) {
      const { data: rows, error } = await context.supabase
        .from(t)
        .select("account_user_id")
        .not("account_user_id", "is", null);
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        if (r.account_user_id) userIds.add(r.account_user_id);
      }
    }
    if (userIds.size === 0) {
      return { recipients: 0, sent: 0, message: "Belum ada kontak yang tertaut akun" };
    }
    const { notifyUsers } = await import("./push.server");
    const result = await notifyUsers({
      userIds: Array.from(userIds),
      payload: {
        title: "Uji notifikasi dari MCM Storage",
        body: "Ini notifikasi uji yang dikirim ke seluruh kontak Anda yang tertaut.",
        url: "/chat",
        tag: "test-contact-all",
      },
    });
    return {
      recipients: userIds.size,
      sent: result.sent,
      message:
        result.sent > 0
          ? `Terkirim ke ${result.sent} perangkat (${userIds.size} pengguna)`
          : `Tidak ada perangkat aktif dari ${userIds.size} pengguna tertaut`,
    };
  });