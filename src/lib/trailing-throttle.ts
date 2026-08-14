/**
 * Throttle dengan trailing edge untuk penjadwalan refresh portal pegawai.
 *
 * Versi lama (`if (since < minGap) return;`) MEMBUANG event yang datang tepat
 * sebelum jeda minimum terpenuhi — burst realtime pada detik minGap-1 tidak
 * pernah menghasilkan refresh. Versi ini menjadwalkan satu refresh terakhir
 * setelah jeda selesai, dan tidak pernah menumpuk lebih dari satu.
 */
export type TrailingThrottle = {
  /** Minta refresh; jalan langsung bila jeda sudah lewat, kalau tidak dijadwalkan. */
  request: (minGapMs: number) => void;
  /** Catat bahwa refresh baru saja berjalan dari jalur lain (mis. manual). */
  markRan: (at?: number) => void;
  dispose: () => void;
};

export function createTrailingThrottle(
  run: () => void,
  opts?: {
    now?: () => number;
    schedule?: (fn: () => void, ms: number) => number;
    cancel?: (id: number) => void;
  },
): TrailingThrottle {
  const now = opts?.now ?? (() => Date.now());
  const schedule = opts?.schedule ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const cancel = opts?.cancel ?? ((id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));

  let lastRunAt = 0;
  let timer: number | null = null;
  let dueAt = 0;

  function fire() {
    timer = null;
    dueAt = 0;
    lastRunAt = now();
    run();
  }

  return {
    request(minGapMs: number) {
      const t = now();
      const since = t - lastRunAt;
      if (since >= minGapMs) {
        if (timer != null) {
          cancel(timer);
          timer = null;
          dueAt = 0;
        }
        lastRunAt = t;
        run();
        return;
      }
      const target = lastRunAt + minGapMs;
      // Sudah ada jadwal yang lebih awal → biarkan (satu refresh saja).
      if (timer != null && dueAt <= target) return;
      if (timer != null) cancel(timer);
      dueAt = target;
      timer = schedule(fire, Math.max(0, target - t));
    },
    markRan(at?: number) {
      lastRunAt = at ?? now();
    },
    dispose() {
      if (timer != null) cancel(timer);
      timer = null;
      dueAt = 0;
    },
  };
}
