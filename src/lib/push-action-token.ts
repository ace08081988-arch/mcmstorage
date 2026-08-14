/**
 * Token aksi notifikasi push (Balas / Tandai dibaca / Tolak panggilan).
 *
 * Aksi ini dijalankan oleh kode NATIVE saat aplikasi tidak hidup, jadi
 * tidak ada sesi Supabase yang bisa dipakai. Alih-alih menaruh access
 * token panjang umur (apalagi service-role key) di dalam APK, server
 * menyisipkan token bertanda tangan HMAC di payload data FCM:
 *
 *   - terikat ke user + conversation + (message | call) + action
 *   - berumur pendek (default 30 menit; panggilan 2 menit)
 *   - sekali pakai (nonce dicatat di `push_action_nonces`)
 *
 * Server WAJIB memverifikasi ulang membership/capability setelah token
 * valid — token hanya membuktikan identitas, bukan izin.
 */

export const PUSH_ACTION_AUDIENCE = "push-action:v1";
export const PUSH_ACTION_TTL_MS = 30 * 60 * 1000;
export const CALL_ACTION_TTL_MS = 2 * 60 * 1000;

export type PushActionName = "reply" | "mark-read" | "call-decline" | "call-accept";

export type PushActionClaims = {
  aud: typeof PUSH_ACTION_AUDIENCE;
  act: PushActionName;
  uid: string;
  cid: string;
  mid?: string;
  callId?: string;
  exp: number;
  nonce: string;
};

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message))));
}

export async function signPushActionToken(
  input: Omit<PushActionClaims, "aud" | "exp" | "nonce"> & { exp?: number; nonce?: string },
  secret: string,
): Promise<string> {
  const claims: PushActionClaims = {
    aud: PUSH_ACTION_AUDIENCE,
    act: input.act,
    uid: input.uid,
    cid: input.cid,
    ...(input.mid ? { mid: input.mid } : {}),
    ...(input.callId ? { callId: input.callId } : {}),
    exp:
      input.exp ??
      Date.now() + (input.act.startsWith("call-") ? CALL_ACTION_TTL_MS : PUSH_ACTION_TTL_MS),
    nonce: input.nonce ?? b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
  const body = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  return `${body}.${await hmac(secret, body)}`;
}

export type PushActionVerifyResult =
  | { ok: true; claims: PushActionClaims }
  | {
      ok: false;
      reason: "malformed" | "bad_signature" | "expired" | "wrong_audience" | "action_mismatch";
    };

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPushActionToken(
  token: string,
  secret: string,
  opts: { action: PushActionName; now?: number },
): Promise<PushActionVerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, sig] = parts as [string, string];
  if (!timingSafeEqualStr(sig, await hmac(secret, body)))
    return { ok: false, reason: "bad_signature" };
  let claims: PushActionClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!claims || typeof claims.exp !== "number" || !claims.uid || !claims.cid || !claims.nonce)
    return { ok: false, reason: "malformed" };
  if (claims.aud !== PUSH_ACTION_AUDIENCE) return { ok: false, reason: "wrong_audience" };
  if (claims.act !== opts.action) return { ok: false, reason: "action_mismatch" };
  if ((opts.now ?? Date.now()) > claims.exp) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}