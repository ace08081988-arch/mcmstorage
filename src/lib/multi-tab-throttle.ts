/**
 * Scheduler coalescing untuk storage event lintas tab.
 *
 * Diekstrak agar logika throttle/leading/maxWait yang dipakai oleh
 * `useLiveSendLogStatus` bisa diuji deterministik dengan fake timers tanpa
 * harus mem-bootstrap jsdom + React lifecycle.
 *
 * Kontrak:
 * - `schedule()` boleh dipanggil berkali-kali; `apply()` HANYA dijalankan
 *   satu kali per jendela coalescing.
 * - Leading-edge: jika sejak apply terakhir sudah lebih dari `maxWait` ms
 *   tidak ada apply, event berikutnya dieksekusi setelah `leading` ms agar
 *   UI tetap responsif di perangkat lemah sekalipun.
 * - Trailing-edge: dalam burst, apply dijadwalkan `throttle` ms setelah
 *   event pertama jendela tersebut, dan event-event berikutnya tidak
 *   mereset timer (sehingga apply tidak bisa diundur tanpa batas).
 * - Guard signature opsional: jika `shouldApply` mengembalikan false saat
 *   timer jatuh tempo, apply di-skip — dipakai untuk mencegah setState
 *   dobel saat beberapa tab menulis payload identik.
 */
export type Tuning = { throttle: number; leading: number; maxWait: number };

type NavLike = {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  connection?: { effectiveType?: string; saveData?: boolean };
} | null | undefined;

export function detectTuning(nav?: NavLike): Tuning {
  try {
    const cores = nav?.hardwareConcurrency ?? 8;
    const mem = nav?.deviceMemory ?? 4;
    const conn = nav?.connection;
    const slowNet =
      conn?.saveData === true ||
      (conn?.effectiveType ? /^(2g|slow-2g|3g)$/.test(conn.effectiveType) : false);
    const slow = cores <= 4 || mem <= 2 || slowNet;
    return slow
      ? { throttle: 160, leading: 24, maxWait: 480 }
      : { throttle: 60, leading: 0, maxWait: 200 };
  } catch {
    return { throttle: 80, leading: 0, maxWait: 240 };
  }
}

export type CoalescingScheduler = {
  schedule: () => void;
  cancel: () => void;
  /** Untuk tes: jumlah `apply()` yang sudah dieksekusi. */
  _appliedCount: () => number;
  /** Untuk tes: apakah ada timer pending. */
  _isPending: () => boolean;
};

export function createCoalescingScheduler(
  apply: () => void,
  tuning: Tuning,
  opts?: {
    now?: () => number;
    setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
    shouldApply?: () => boolean;
  },
): CoalescingScheduler {
  const now = opts?.now ?? (() => Date.now());
  const setT = opts?.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const clearT = opts?.clearTimeoutFn ?? ((id) => clearTimeout(id));
  const guard = opts?.shouldApply ?? (() => true);

  let pending: ReturnType<typeof setTimeout> | null = null;
  let firstScheduledAt = 0;
  let lastAppliedAt = 0;
  let appliedCount = 0;

  const fire = () => {
    pending = null;
    if (!guard()) return;
    lastAppliedAt = now();
    appliedCount += 1;
    apply();
  };

  return {
    schedule() {
      const t = now();
      // Leading-edge: idle cukup lama → pakai delay pendek `leading`.
      if (!pending && t - lastAppliedAt > tuning.maxWait) {
        firstScheduledAt = t;
        pending = setT(fire, tuning.leading);
        return;
      }
      // Sudah ada timer → biarkan (jangan reset). Trailing-edge dijaga.
      if (pending) return;
      // Idle pendek → throttle penuh.
      firstScheduledAt = t;
      pending = setT(fire, tuning.throttle);
    },
    cancel() {
      if (pending) {
        clearT(pending);
        pending = null;
      }
    },
    _appliedCount: () => appliedCount,
    _isPending: () => pending !== null,
  };
}