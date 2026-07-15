/**
 * Utilitas ringan untuk meredam badai event realtime Supabase. Handler
 * `postgres_changes` bisa terpanggil puluhan kali dalam hitungan detik
 * (mis. saat backfill/bulk-insert), dan tiap panggilan biasanya memicu
 * `invalidateQueries` → re-fetch → re-render. Untuk daftar yang tampil
 * ke user, kita cukup me-refresh SEKALI setelah gelombang event mereda.
 *
 * Dua bentuk:
 *   - `debounce(fn, wait)` — tunda eksekusi sampai `wait` ms tanpa event
 *     baru. Cocok untuk invalidasi list (unread, conversations, prep,
 *     request).
 *   - `leadingThrottle(fn, wait)` — eksekusi segera, lalu tolak panggilan
 *     berikutnya selama `wait` ms. Cocok untuk indikator "sedang ada
 *     aktivitas" yang butuh responsif tapi tidak boleh spam.
 *
 * Keduanya expose `.cancel()` supaya bisa dibersihkan pada unmount.
 */
export type CancelableFn = (() => void) & { cancel: () => void };

export function debounce(fn: () => void, wait = 300): CancelableFn {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, wait);
  }) as CancelableFn;
  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}

export function leadingThrottle(fn: () => void, wait = 300): CancelableFn {
  let last = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (() => {
    const now = Date.now();
    const gap = now - last;
    if (gap >= wait) {
      last = now;
      fn();
      return;
    }
    // Pastikan event terakhir tidak hilang: jadwalkan sekali di trailing.
    if (trailing) return;
    trailing = setTimeout(() => {
      trailing = null;
      last = Date.now();
      fn();
    }, wait - gap);
  }) as CancelableFn;
  wrapped.cancel = () => {
    if (trailing) {
      clearTimeout(trailing);
      trailing = null;
    }
  };
  return wrapped;
}