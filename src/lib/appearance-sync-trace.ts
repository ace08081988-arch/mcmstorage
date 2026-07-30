/**
 * Jejak sinkronisasi preset tampilan per perangkat (indikator status
 * "terakhir disimpan / terakhir diambil" di halaman Pengaturan Tampilan).
 *
 * Modul terpisah supaya halaman pengaturan tidak lagi mem-parse JSON
 * sendiri — guard `appearance-migrator.single-source` menjaga agar satu-
 * satunya `JSON.parse` di halaman itu adalah payload preset.
 */
import { scopedKey, peekUserIdSync } from "@/lib/user-scoped-storage";

export type SyncTrace = {
  pushAt: string | null;
  pullAt: string | null;
  error: string | null;
};

const SYNC_TRACE_LS = "appearance-sync-trace";

export const EMPTY_SYNC_TRACE: SyncTrace = { pushAt: null, pullAt: null, error: null };

export function readSyncTrace(): SyncTrace {
  if (typeof window === "undefined") return { ...EMPTY_SYNC_TRACE };
  try {
    const raw = localStorage.getItem(scopedKey(SYNC_TRACE_LS, peekUserIdSync()));
    if (!raw) return { ...EMPTY_SYNC_TRACE };
    const p = JSON.parse(raw) as Partial<SyncTrace>;
    return {
      pushAt: typeof p.pushAt === "string" ? p.pushAt : null,
      pullAt: typeof p.pullAt === "string" ? p.pullAt : null,
      error: typeof p.error === "string" ? p.error : null,
    };
  } catch {
    return { ...EMPTY_SYNC_TRACE };
  }
}

export function writeSyncTrace(t: SyncTrace) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(scopedKey(SYNC_TRACE_LS, peekUserIdSync()), JSON.stringify(t));
  } catch {
    /* kuota penuh — indikator boleh gagal diam-diam */
  }
}
