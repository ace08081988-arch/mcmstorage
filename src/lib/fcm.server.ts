// FCM HTTP v1 sender (Cloudflare Worker compatible, uses WebCrypto).
// Requires secret FCM_SERVICE_ACCOUNT_JSON — the full JSON of a service
// account with the "Firebase Cloud Messaging API" role.

import type { PushPayload } from "./push.server";

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let cached: { token: string; exp: number } | null = null;
let sa: ServiceAccount | null = null;

function getSA(): ServiceAccount | null {
  if (sa) return sa;
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    sa = JSON.parse(raw) as ServiceAccount;
    return sa;
  } catch {
    return null;
  }
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlStr(s: string): string {
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

async function getAccessToken(): Promise<string | null> {
  const acc = getSA();
  if (!acc) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: acc.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: acc.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(acc.private_key.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch(acc.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    console.warn("[fcm] token exchange failed", res.status, await res.text());
    return null;
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

export type FcmTokenRow = { id: string; token: string };

/**
 * Channel Android stabil — HARUS sama persis dengan `NOTIF_CHANNELS`
 * di `src/lib/local-notify.ts` dan konstanta di `AceMessagingService.java`.
 */
export const FCM_CHANNELS = {
  chat: "mcm_chat",
  call: "mcm_call",
  tugas: "mcm_tugas",
  order: "mcm_order",
  system: "mcm_system",
} as const;

export function channelIdForKind(kind?: string): string {
  if (!kind) return FCM_CHANNELS.system;
  return (FCM_CHANNELS as Record<string, string>)[kind] ?? FCM_CHANNELS.system;
}

/**
 * Send one FCM message. Returns ok=false + status when the token is dead.
 *
 * Selalu **data-only + HIGH priority** supaya `AceMessagingService` di
 * Android ikut dipanggil saat aplikasi mati/di-background dan bisa
 * membangun MessagingStyle/CallStyle sendiri (notifikasi otomatis Android
 * tidak bisa punya tombol Balas atau bubble).
 */
export async function sendFcm(
  row: FcmTokenRow,
  payload: PushPayload,
  extraData?: Record<string, string>,
) {
  const acc = getSA();
  if (!acc) return { ok: false as const, status: 0, error: "not_configured" };
  const access = await getAccessToken();
  if (!access) return { ok: false as const, status: 0, error: "no_access_token" };

  const isCall = payload.kind === "call";
  const channelId = channelIdForKind(payload.kind);
  const data: Record<string, string> = {
    title: payload.title,
    body: payload.body,
    channelId,
    kind: payload.kind ?? "system",
    ...(extraData ?? {}),
  };
  if (payload.url) data.url = payload.url;
  if (payload.tag) data.tag = payload.tag;
  if (payload.conversationId) data.conversationId = payload.conversationId;
  if (payload.messageId) data.messageId = payload.messageId;
  if (payload.senderName) data.senderName = payload.senderName;
  if (payload.senderId) data.senderId = payload.senderId;
  if (payload.icon) data.icon = payload.icon;
  if (payload.callId) data.callId = payload.callId;
  if (payload.callKind) data.callKind = payload.callKind;
  if (payload.callerName) data.callerName = payload.callerName;

  const body = {
    message: {
      token: row.token,
      data,
      android: {
        priority: "HIGH" as const,
        // TTL pendek untuk panggilan: push yang telat tidak boleh
        // memunculkan layar "panggilan masuk" basi.
        ttl: isCall ? "35s" : "3600s",
        direct_boot_ok: true,
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: {
          aps: {
            alert: { title: payload.title, body: payload.body },
            sound: isCall ? "default" : undefined,
            "content-available": 1,
          },
        },
      },
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${acc.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (res.ok) return { ok: true as const };
  const text = await res.text().catch(() => "");
  return { ok: false as const, status: res.status, error: text.slice(0, 300) };
}

export function isFcmConfigured(): boolean {
  return !!getSA();
}

export async function sendFcmToUsers(opts: {
  userIds: string[];
  excludeUserId?: string;
  payload: PushPayload;
}) {
  if (!isFcmConfigured()) return { sent: 0, pruned: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const targets = opts.userIds.filter((u) => u && u !== opts.excludeUserId);
  if (targets.length === 0) return { sent: 0, pruned: 0 };
  const { data: rows, error } = await supabaseAdmin
    .from("fcm_tokens")
    .select("id, token, user_id")
    .in("user_id", targets);
  if (error || !rows || rows.length === 0) return { sent: 0, pruned: 0 };

  // Token aksi per PENERIMA (bukan per device) — dipakai tombol Balas /
  // Tandai dibaca / Tolak saat aplikasi tidak hidup. Bila secret belum
  // dikonfigurasi, data aksi dikosongkan dan Android otomatis hanya
  // menampilkan tap-to-open (lihat AceMessagingService).
  const perUser = new Map<string, Record<string, string>>();
  try {
    const { pushActionSecret } = await import("./push-ownership.server");
    const secret = pushActionSecret();
    const cid = opts.payload.conversationId;
    if (secret && cid) {
      const { signPushActionToken } = await import("./push-action-token");
      const uniqueUsers = [...new Set((rows as { user_id: string }[]).map((r) => r.user_id))];
      await Promise.all(
        uniqueUsers.map(async (uid) => {
          const base = { uid, cid, mid: opts.payload.messageId, callId: opts.payload.callId };
          const extra: Record<string, string> = {};
          if (opts.payload.kind === "call" && opts.payload.callId) {
            extra.declineToken = await signPushActionToken(
              { ...base, act: "call-decline" },
              secret,
            );
          } else {
            extra.replyToken = await signPushActionToken({ ...base, act: "reply" }, secret);
            extra.markReadToken = await signPushActionToken(
              { ...base, act: "mark-read" },
              secret,
            );
          }
          perUser.set(uid, extra);
        }),
      );
    }
  } catch (e) {
    console.warn("[fcm] gagal membuat token aksi", e);
  }

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    (rows as { id: string; token: string; user_id: string }[]).map(async (r) => {
      const res = await sendFcm(r, opts.payload, perUser.get(r.user_id));
      if (res.ok) sent++;
      else if (res.status === 404 || res.status === 400) {
        // UNREGISTERED / INVALID_ARGUMENT — prune stale token
        if (/UNREGISTERED|INVALID_ARGUMENT|not a valid FCM registration/i.test(res.error || "")) {
          dead.push(r.id);
        }
      }
    }),
  );
  let pruned = 0;
  if (dead.length > 0) {
    const { error: delErr, count } = await supabaseAdmin
      .from("fcm_tokens")
      .delete({ count: "exact" })
      .in("id", dead);
    if (!delErr) pruned = count ?? dead.length;
  }
  return { sent, pruned };
}