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
import { useCallback, useEffect, useRef, useState } from "react";
import { peekUserIdSync, scopedKey } from "@/lib/user-scoped-storage";

const VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // draft basi > 24 jam diabaikan

type Draft<T> = { v: number; at: number; data: T };

/**
 * Status penyimpanan draft — dipakai UI untuk memberi tahu user secara jujur
 * seberapa "aman" ketikannya:
 *  - "idle"    : belum ada yang disimpan
 *  - "ok"      : tersimpan di localStorage (aman walau app ditutup)
 *  - "memory"  : localStorage ditolak/penuh → draft hanya di memori halaman
 *  - "none"    : gagal total (bahkan memori tidak tersedia) — tidak seharusnya terjadi
 */
export type DraftStatus = "idle" | "ok" | "memory" | "none";

/**
 * Fallback memori: bertahan selama dokumen tidak di-reload. Cukup untuk
 * kasus yang paling sering merusak kerja di lapangan — remount subtree oleh
 * DomRaceBoundary — meski localStorage diblokir (private mode / kuota penuh).
 */
const memoryDrafts = new Map<string, Draft<unknown>>();

function isStorageWritable(): boolean {
  try {
    const probe = "__mcm_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function readFormDraft<T>(base: string, uid?: string | null): Partial<T> | null {
  if (typeof window === "undefined") return null;
  const key = scopedKey(base, uid ?? peekUserIdSync());
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Draft<Partial<T>>;
      if (parsed && parsed.v === VERSION && typeof parsed.at === "number") {
        if (Date.now() - parsed.at > MAX_AGE_MS) return null;
        return parsed.data ?? null;
      }
    }
  } catch {
    /* storage ditolak → coba memori di bawah */
  }
  const mem = memoryDrafts.get(key) as Draft<Partial<T>> | undefined;
  if (mem && Date.now() - mem.at <= MAX_AGE_MS) return mem.data ?? null;
  return null;
}

export function clearFormDraft(base: string, uid?: string | null): void {
  if (typeof window === "undefined") return;
  const key = scopedKey(base, uid ?? peekUserIdSync());
  memoryDrafts.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

/** Simpan draft; kembalikan status penyimpanan yang benar-benar terjadi. */
export function writeFormDraft<T>(base: string, uid: string | null, data: T): DraftStatus {
  if (typeof window === "undefined") return "none";
  const key = scopedKey(base, uid);
  const payload: Draft<T> = { v: VERSION, at: Date.now(), data };
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
    memoryDrafts.delete(key);
    return "ok";
  } catch {
    try {
      memoryDrafts.set(key, payload as Draft<unknown>);
      return "memory";
    } catch {
      return "none";
    }
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
): { clear: () => void; status: DraftStatus; savedAt: number | null; storageBlocked: boolean } {
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const hydrated = useRef(false);
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setStorageBlocked(!isStorageWritable());
  }, []);

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
      const s = writeFormDraft(base, uid, value);
      setStatus(s);
      setStorageBlocked(s !== "ok");
      if (s !== "none") setSavedAt(Date.now());
    }, 300);
    return () => window.clearTimeout(t);
  }, [base, uid, value, enabled]);

  const clear = useCallback(() => {
    clearFormDraft(base, uid);
    setStatus("idle");
    setSavedAt(null);
  }, [base, uid]);

  return { clear, status, savedAt, storageBlocked };
}
