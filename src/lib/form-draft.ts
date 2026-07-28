/**
 * Draft form persisten (anti kehilangan ketikan).
 *
 * Latar belakang lapangan: di Android WebView, form panjang seperti
 * "Catat Pembelian" bisa kehilangan seluruh isinya ketika
 *   (a) WebView me-restart tab karena tekanan memori saat keyboard/notifikasi
 *       heads-up muncul, atau
 *   (b) `DomRaceBoundary` memulihkan bagian halaman setelah race DOM
 *       (`removeChild`) — pemulihan itu me-remount subtree, sehingga semua
 *       `useState` lokal kembali kosong.
 *
 * Hook ini menyimpan nilai form ke `localStorage` (ter-scope per user) dengan
 * debounce, lalu memulihkannya sekali saat mount. Efeknya: remount/crash
 * recovery tidak lagi menghapus pekerjaan yang sedang diketik.
 */
import { useEffect, useRef } from "react";
import { peekUserIdSync, scopedKey } from "@/lib/user-scoped-storage";

const VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // draft basi > 24 jam diabaikan

type Draft<T> = { v: number; at: number; data: T };

export function readFormDraft<T>(base: string, uid?: string | null): Partial<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(scopedKey(base, uid ?? peekUserIdSync()));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft<Partial<T>>;
    if (!parsed || parsed.v !== VERSION || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function clearFormDraft(base: string, uid?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(scopedKey(base, uid ?? peekUserIdSync()));
  } catch {
    /* private mode */
  }
}

/**
 * @param base    key dasar, mis. "mcm:draft:gudang-beli"
 * @param uid     user id (boleh null → "anon")
 * @param value   snapshot nilai form saat ini (obyek serializable)
 * @param restore dipanggil SEKALI saat mount bila ada draft tersimpan
 * @param enabled matikan bila form sedang tidak layak disimpan
 */
export function useFormDraft<T extends Record<string, unknown>>(
  base: string,
  uid: string | null,
  value: T,
  restore: (draft: Partial<T>) => void,
  enabled = true,
): { clear: () => void } {
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    if (!enabled) return;
    const d = readFormDraft<T>(base, uid);
    if (d && Object.keys(d).length > 0) restoreRef.current(d);
    // sengaja hanya sekali per mount: pemulihan tidak boleh menimpa ketikan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled || !hydrated.current || typeof window === "undefined") return;
    const t = window.setTimeout(() => {
      try {
        const payload: Draft<T> = { v: VERSION, at: Date.now(), data: value };
        window.localStorage.setItem(scopedKey(base, uid), JSON.stringify(payload));
      } catch {
        /* kuota penuh / private mode — abaikan, jangan ganggu user */
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [base, uid, value, enabled]);

  return {
    clear: () => clearFormDraft(base, uid),
  };
}
