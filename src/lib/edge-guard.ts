/**
 * Primitif keamanan bersama untuk endpoint publik (`/api/public/*`).
 *
 * Semua fungsi di sini murni/tanpa I/O eksternal supaya bisa diuji unit.
 * Catatan jujur: rate limit di bawah bersifat *per-instance memory* — pada
 * runtime worker yang di-scale horizontal batasnya berlaku per instance,
 * bukan global. Ini pengaman abuse dasar, bukan jaminan kuota ketat.
 */

/** Perbandingan string tahan timing attack (panjang tetap dibocorkan). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Samakan panjang agar loop selalu berjalan penuh.
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

/** Fixed-window limiter sederhana. `now` disuntik untuk pengujian. */
export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number; now?: number },
): RateLimitResult {
  const now = opts.now ?? Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    if (buckets.size > MAX_BUCKETS) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      if (buckets.size > MAX_BUCKETS) buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, remaining: opts.limit - 1, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  if (existing.count > opts.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return {
    allowed: true,
    remaining: opts.limit - existing.count,
    retryAfterSeconds: 0,
  };
}

/** Hanya untuk pengujian: kosongkan state limiter. */
export function __resetRateLimit(): void {
  buckets.clear();
}

/** Identitas pemanggil terbaik yang tersedia dari header proxy. */
export function clientKeyFromRequest(request: Request, salt = ""): string {
  const h = request.headers;
  const ip =
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ??
    "";
  const ua = (h.get("user-agent") ?? "").slice(0, 80);
  return `${salt}|${ip || "unknown"}|${ua}`;
}

export const RATE_LIMITED_BODY = { ok: false, error: "rate_limited" } as const;

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(RATE_LIMITED_BODY, {
    status: 429,
    headers: { "retry-after": String(retryAfterSeconds) },
  });
}

/**
 * Baca JSON dengan batas ukuran keras. Menolak body > `maxBytes`
 * (termasuk saat `content-length` bohong) supaya payload tidak unbounded.
 */
export async function readBoundedJson(
  request: Request,
  maxBytes = 8 * 1024,
): Promise<{ ok: true; value: unknown } | { ok: false; error: "too_large" | "invalid_json" }> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, error: "too_large" };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, error: "too_large" };
  try {
    return { ok: true, value: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}
