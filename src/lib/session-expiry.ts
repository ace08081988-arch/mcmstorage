/**
 * Timer kedaluwarsa sesi PIN portal pegawai.
 *
 * Sebelumnya parent memakai `setInterval(1000)` + state `now` sehingga SELURUH
 * portal (semua kartu item + foto) rerender tiap detik. Sekarang parent hanya
 * memasang SATU timeout tepat pada waktu expiry; label hitung mundur dirender
 * komponen kecil terpisah.
 *
 * Perilaku penting yang dipertahankan: bila operasi pegawai sedang aktif
 * (kamera/editor/upload), expiry DITUNDA dan dieksekusi tepat sekali setelah
 * operasi selesai.
 */
export type SessionExpiryTimer = {
  /** Pasang timer pada waktu absolut (ms epoch). null = matikan. */
  arm: (expiresAt: number | null) => void;
  /** Jalankan expiry tertunda bila ada (dipanggil saat semua operasi selesai). */
  flushPending: () => void;
  hasPending: () => boolean;
  dispose: () => void;
};

export function createSessionExpiryTimer(opts: {
  isBusy: () => boolean;
  onExpire: () => void;
  /** Dipanggil sekali saat expiry ditunda karena sedang sibuk. */
  onDefer?: () => void;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => number;
  cancel?: (id: number) => void;
}): SessionExpiryTimer {
  const now = opts.now ?? (() => Date.now());
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const cancel = opts.cancel ?? ((id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));

  let timer: number | null = null;
  let armedAt: number | null = null;
  let pending = false;

  function clear() {
    if (timer != null) cancel(timer);
    timer = null;
  }

  function fire() {
    timer = null;
    armedAt = null;
    if (opts.isBusy()) {
      if (!pending) {
        pending = true;
        opts.onDefer?.();
      }
      return;
    }
    opts.onExpire();
  }

  return {
    arm(expiresAt: number | null) {
      if (expiresAt == null) {
        clear();
        armedAt = null;
        return;
      }
      if (timer != null && armedAt === expiresAt) return;
      clear();
      armedAt = expiresAt;
      timer = schedule(fire, Math.max(0, expiresAt - now()));
    },
    flushPending() {
      if (!pending) return;
      pending = false;
      opts.onExpire();
    },
    hasPending: () => pending,
    dispose() {
      clear();
      armedAt = null;
    },
  };
}
