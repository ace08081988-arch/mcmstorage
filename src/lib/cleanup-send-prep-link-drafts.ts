/**
 * Startup cleanup: hapus semua draft `mcm:sendPrepLink:workerName:*` yang
 * tertinggal dari sesi sebelumnya.
 *
 * Kenapa perlu:
 * - `SendPrepLinkDialog` menyimpan draft nama pegawai per-title di
 *   `localStorage[mcm:sendPrepLink:workerName:<titleId>]`.
 * - Cleanup normal terjadi saat dialog di-unmount, tapi kalau app di-kill
 *   secara paksa (WebView di-swipe, crash, force-stop), draft bisa
 *   tertinggal → berpotensi bocor ke session berikutnya bila title dengan
 *   id yang sama dipakai kembali.
 * - Aman untuk dihapus semua saat startup: dialog akan re-hidrasi dari
 *   server / state fresh, bukan dari localStorage yang basi.
 *
 * No-op di SSR (tidak ada `window`) dan bila `localStorage` tidak tersedia
 * (private mode / quota exceeded).
 */
const PREFIX = "mcm:sendPrepLink:workerName:";

export function cleanupSendPrepLinkDrafts(): number {
  if (typeof window === "undefined") return 0;
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      try {
        window.localStorage.removeItem(k);
        removed++;
      } catch {
        /* ignore per-key */
      }
    }
  } catch {
    /* localStorage tak tersedia — no-op */
  }
  return removed;
}