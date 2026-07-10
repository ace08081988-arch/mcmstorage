import webpush from "web-push";

let configured = false;

// Workerd's `Buffer` polyfill (via unenv/nodejs_compat) is backed by a
// Uint8Array subclass whose prototype chain does not always expose
// `Object.prototype.hasOwnProperty`. `web-push` internally calls
// `buffer.hasOwnProperty(...)` while validating VAPID/subscription keys,
// which throws `buffer.hasOwnProperty is not a function` on the edge.
// Patch the prototypes once so the check works.
function ensureBufferHasOwnPropertyShim() {
  const hop = Object.prototype.hasOwnProperty;
  const targets: unknown[] = [
    (globalThis as { Buffer?: { prototype?: object } }).Buffer?.prototype,
    Uint8Array.prototype,
  ];
  for (const proto of targets) {
    if (proto && typeof (proto as { hasOwnProperty?: unknown }).hasOwnProperty !== "function") {
      Object.defineProperty(proto, "hasOwnProperty", {
        value: hop,
        writable: true,
        configurable: true,
      });
    }
  }
}

export const VAPID_PUBLIC_KEY =
  "BPu9dnY_SQKEYY_G9tz1YjsBWMuoYZbHPa0lDz0oSsH35dtczBKPIPCxXEF4UuMnDHH_ln-agOhpJwQLmcgNEHw";

function ensureConfigured() {
  if (configured) return;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const rawSubject = (process.env.VAPID_SUBJECT || "mailto:admin@example.com").trim();
  const subject = normalizeVapidSubject(rawSubject);
  if (!priv) throw new Error("VAPID_PRIVATE_KEY tidak diset");
  ensureBufferHasOwnPropertyShim();
  webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, priv);
  configured = true;
}

// VAPID subject harus berupa URL absolut valid (RFC 8292: mailto: atau https:).
// Env kadang berisi email polos (`ops@example.com`) — normalisasi otomatis ke
// `mailto:` supaya web-push tidak melempar "Vapid subject is not a valid URL".
function normalizeVapidSubject(input: string): string {
  const s = input.trim();
  if (!s) return "mailto:admin@example.com";
  const lower = s.toLowerCase();
  if (lower.startsWith("mailto:") || lower.startsWith("http://") || lower.startsWith("https://")) {
    try {
      // eslint-disable-next-line no-new
      new URL(s);
      return s;
    } catch {
      // fallthrough ke fallback aman
    }
  }
  // Bentuk email polos → prefix mailto:
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
  // Fallback aman: hindari crash runtime, log detail server-side.
  console.warn("[push] VAPID_SUBJECT tidak valid, fallback ke mailto:admin@example.com");
  return "mailto:admin@example.com";
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
  // "order"/"tugas" cocok dgn enabledKinds di public/sw-push.js supaya
  // toggle kategori notifikasi di pengaturan benar-benar berlaku.
  kind?: "chat" | "generic" | "security" | "system" | "order" | "tugas";
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
  // H17: dedup web-push vs FCM. Pengguna yang punya token FCM native
  // (Android/iOS APK) akan menerima notifikasi via FCM — jangan kirim
  // ulang lewat web-push supaya tidak dobel. Web-push tetap dipakai
  // untuk pengguna yang hanya buka via browser (tanpa FCM token).
  const { data: nativeRows } = await supabaseAdmin
    .from("fcm_tokens")
    .select("user_id, platform")
    .in("user_id", targets);
  const nativeUserIds = new Set<string>(
    (nativeRows ?? [])
      .filter((r) => r.platform === "android" || r.platform === "ios")
      .map((r) => r.user_id),
  );
  const webTargets = targets.filter((u) => !nativeUserIds.has(u));
  const { data: subs, error } = webTargets.length > 0
    ? await supabaseAdmin
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .in("user_id", webTargets)
    : { data: [], error: null };
  if (error) return { sent: 0, pruned: 0 };
  const subsSafe = subs ?? [];
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    subsSafe.map(async (s) => {
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