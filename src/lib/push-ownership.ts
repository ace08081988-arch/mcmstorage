/**
 * Token kepemilikan langganan push berumur pendek.
 *
 * Service worker tidak punya sesi login, jadi saat `pushsubscriptionchange`
 * ia harus membuktikan bahwa endpoint LAMA memang miliknya. Sebelumnya
 * endpoint lama saja dianggap bukti — artinya siapa pun yang tahu endpoint
 * (mis. dari log) bisa membajak baris langganan. Sekarang server menerbitkan
 * token bertanda tangan HMAC saat langganan didaftarkan oleh pengguna yang
 * sudah login, dan endpoint publik memverifikasinya.
 *
 * Proteksi replay: token terikat ke endpoint lama + user_id. Setelah rotasi,
 * baris endpoint lama tidak ada lagi, sehingga token yang sama tidak bisa
 * dipakai ulang (single-use by construction) di samping batas `exp`.
 */
export const PUSH_OWNERSHIP_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

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
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return b64url(new Uint8Array(sig));
}

export type PushOwnershipClaims = { endpoint: string; userId: string; exp: number; nonce: string };

export async function signPushOwnershipToken(
  claims: Omit<PushOwnershipClaims, "nonce" | "exp"> & { exp?: number; nonce?: string },
  secret: string,
): Promise<string> {
  const payload: PushOwnershipClaims = {
    endpoint: claims.endpoint,
    userId: claims.userId,
    exp: claims.exp ?? Date.now() + PUSH_OWNERSHIP_TTL_MS,
    nonce: claims.nonce ?? b64url(crypto.getRandomValues(new Uint8Array(12))),
  };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export type VerifyResult =
  | { ok: true; claims: PushOwnershipClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "endpoint_mismatch" };

export async function verifyPushOwnershipToken(
  token: string,
  secret: string,
  opts: { endpoint: string; now?: number },
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, sig] = parts as [string, string];
  const expected = await hmac(secret, body);
  // Bandingkan konstan-waktu.
  const { timingSafeEqualStr } = await import("./edge-guard");
  if (!timingSafeEqualStr(sig, expected)) return { ok: false, reason: "bad_signature" };
  let claims: PushOwnershipClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof claims?.exp !== "number" || !claims.endpoint || !claims.userId)
    return { ok: false, reason: "malformed" };
  if ((opts.now ?? Date.now()) > claims.exp) return { ok: false, reason: "expired" };
  if (claims.endpoint !== opts.endpoint) return { ok: false, reason: "endpoint_mismatch" };
  return { ok: true, claims };
}
