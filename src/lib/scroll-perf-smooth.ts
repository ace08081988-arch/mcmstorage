/**
 * Utilitas penghalusan time-series performa scroll.
 *
 * Dipakai bersama oleh grafik realtime dan ekspor CSV agar kolom "tren"
 * di file hasil unduhan identik dengan garis yang terlihat di layar.
 */

/** Metode penghalusan garis tren. */
export type SmoothMethod = "sma" | "ema" | "median";

export const SMOOTH_MIN = 1;
export const SMOOTH_MAX = 30;

export const SMOOTH_METHOD_OPTIONS: {
  v: SmoothMethod;
  label: string;
  short: string;
  hint: string;
}[] = [
  {
    v: "sma",
    label: "Rata-rata",
    short: "SMA",
    hint: "Simple moving average — semua titik dalam jendela berbobot sama",
  },
  {
    v: "ema",
    label: "EMA",
    short: "EMA",
    hint: "Exponential moving average — titik terbaru berbobot lebih besar, reaksi lebih cepat",
  },
  {
    v: "median",
    label: "Median",
    short: "Median",
    hint: "Median bergerak — paling tahan terhadap spike ekstrem",
  },
];

/** Bulatkan & jepit ukuran jendela ke rentang yang valid. */
export function clampSmooth(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(SMOOTH_MAX, Math.max(SMOOTH_MIN, Math.round(v)));
}

/** Rata-rata bergerak (trailing) — memisahkan tren dari spike sesaat. */
export function rollingAverage(values: number[], window: number): number[] {
  if (window <= 1) return values;
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] ?? 0;
    if (i >= window) sum -= values[i - window] ?? 0;
    const n = Math.min(i + 1, window);
    out.push(Math.round((sum / n) * 10) / 10);
  }
  return out;
}

/** Exponential moving average; `window` dipetakan ke alpha 2/(N+1). */
export function exponentialAverage(values: number[], window: number): number[] {
  if (window <= 1) return values;
  const alpha = 2 / (window + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0;
    prev = i === 0 ? v : prev + alpha * (v - prev);
    out.push(Math.round(prev * 10) / 10);
  }
  return out;
}

/** Median bergerak (trailing) — tahan terhadap outlier tunggal. */
export function movingMedian(values: number[], window: number): number[] {
  if (window <= 1) return values;
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const slice = values
      .slice(Math.max(0, i - window + 1), i + 1)
      .sort((a, b) => a - b);
    const mid = slice.length >> 1;
    const m =
      slice.length % 2
        ? (slice[mid] ?? 0)
        : ((slice[mid - 1] ?? 0) + (slice[mid] ?? 0)) / 2;
    out.push(Math.round(m * 10) / 10);
  }
  return out;
}

/** Terapkan metode penghalusan terpilih. */
export function smoothSeries(
  values: number[],
  window: number,
  method: SmoothMethod,
): number[] {
  if (window <= 1) return values;
  if (method === "ema") return exponentialAverage(values, window);
  if (method === "median") return movingMedian(values, window);
  return rollingAverage(values, window);
}

/** Label pendek metode untuk ditulis ke tooltip / CSV. */
export function smoothMethodShort(method: SmoothMethod): string {
  return SMOOTH_METHOD_OPTIONS.find((o) => o.v === method)?.short ?? "SMA";
}