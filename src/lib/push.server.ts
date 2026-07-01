import webpush from "web-push";

let configured = false;

export const VAPID_PUBLIC_KEY =
  "BPu9dnY_SQKEYY_G9tz1YjsBWMuoYZbHPa0lDz0oSsH35dtczBKPIPCxXEF4UuMnDHH_ln-agOhpJwQLmcgNEHw";

function ensureConfigured() {
  if (configured) return;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!priv) throw new Error("VAPID_PRIVATE_KEY tidak diset");
  webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, priv);
  configured = true;
}

export type PushSubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  conversationId?: string;
  messageId?: string;
  icon?: string;
  badge?: string;
  image?: string;
  kind?: "chat" | "generic" | "security" | "system";
  requireInteraction?: boolean;
  silent?: boolean;
  vibrate?: number[];
  timestamp?: number;
  actions?: { action: string; title: string; icon?: string }[];
};

export async function sendWebPush(sub: PushSubRow, payload: PushPayload) {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 },
    );
    return { ok: true as const };
  } catch (e: unknown) {
    const status = (e as { statusCode?: number })?.statusCode;
    return { ok: false as const, status, error: (e as Error)?.message ?? "push_failed" };
  }
}

/**
 * Server-only helper: send a push to many users, pruning dead endpoints.
 * `excludeUserId` (typically the sender) will be skipped.
 */
export async function notifyUsers(opts: {
  userIds: string[];
  excludeUserId?: string;
  payload: PushPayload;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const targets = opts.userIds.filter((u) => u && u !== opts.excludeUserId);
  if (targets.length === 0) return { sent: 0, pruned: 0 };
  const { data: subs, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", targets);
  if (error || !subs || subs.length === 0) return { sent: 0, pruned: 0 };
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      const r = await sendWebPush(s, opts.payload);
      if (r.ok) sent++;
      else if (r.status === 404 || r.status === 410) dead.push(s.id);
    }),
  );
  let pruned = 0;
  if (dead.length > 0) {
    const { error: delErr, count } = await supabaseAdmin
      .from("push_subscriptions")
      .delete({ count: "exact" })
      .in("id", dead);
    if (!delErr) pruned = count ?? dead.length;
  }
  // Fan out ke perangkat native (FCM) juga
  let fcmSent = 0;
  let fcmPruned = 0;
  try {
    const { sendFcmToUsers } = await import("./fcm.server");
    const r = await sendFcmToUsers({
      userIds: opts.userIds,
      excludeUserId: opts.excludeUserId,
      payload: opts.payload,
    });
    fcmSent = r.sent;
    fcmPruned = r.pruned;
  } catch (e) {
    console.warn("[push] fcm fan-out gagal", e);
  }
  return { sent: sent + fcmSent, pruned: pruned + fcmPruned };
}