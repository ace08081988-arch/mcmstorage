/**
 * Namespacing key `localStorage` per-user/session.
 *
 * Kenapa perlu:
 * - Draft seperti `mcm:sendPrepLink:workerName:<titleId>` disimpan di
 *   `localStorage` device. Bila dua akun berbeda pernah login di device
 *   yang sama (owner + pegawai, atau ganti tenant), key tanpa scope bisa
 *   membaca draft milik user sebelumnya.
 * - Dengan menyisipkan `:u:<userId>` di dalam key, draft milik user A
 *   secara fisik terisolasi dari user B. Cleanup startup + tear-down
 *   dialog tetap berjalan seperti biasa.
 *
 * Peek sinkron: kita butuh user id saat komponen pertama kali render
 * (mount initializer `useState`). `peekCachedUserId()` dari current-user
 * hanya terisi setelah `getUser()` sekali resolve, jadi sebagai fallback
 * kita baca session Supabase langsung dari `localStorage` (kunci
 * `sb-<projectRef>-auth-token`).
 */
import { peekCachedUserId } from "@/lib/current-user";

const SUPABASE_TOKEN_RE = /^sb-.+-auth-token$/;

/** Baca user id sinkron; null bila belum ada sesi. */
export function peekUserIdSync(): string | null {
  const c = peekCachedUserId();
  if (c) return c;
  if (typeof window === "undefined") return null;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !SUPABASE_TOKEN_RE.test(k)) continue;
      const raw = window.localStorage.getItem(k);
      if (!raw) continue;
      // Supabase v2 menyimpan array [access, refresh, ...] ATAU objek
      // `{ user: {...}, access_token, ... }`. Coba dua bentuk.
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        const user = obj.user as { id?: unknown } | undefined;
        if (user && typeof user.id === "string") return user.id;
        const currentSession = obj.currentSession as
          | { user?: { id?: unknown } }
          | undefined;
        if (currentSession?.user && typeof currentSession.user.id === "string") {
          return currentSession.user.id;
        }
      }
    }
  } catch {
    /* private mode / JSON rusak — abaikan */
  }
  return null;
}

/**
 * Bangun key ter-scope: `<base>:u:<userId | "anon">:<...suffix>`.
 * Contoh: `scopedKey("mcm:sendPrepLink:workerName", uid, titleId)` →
 *         `mcm:sendPrepLink:workerName:u:<uid>:<titleId>`.
 */
export function scopedKey(
  base: string,
  userId: string | null | undefined,
  ...suffix: (string | null | undefined)[]
): string {
  const uid = userId && userId.length > 0 ? userId : "anon";
  const tail = suffix.filter((s): s is string => !!s).join(":");
  return tail ? `${base}:u:${uid}:${tail}` : `${base}:u:${uid}`;
}