/**
 * Statistik ringan untuk micro-benchmark: p50/p95, mean, stddev, dan
 * coefficient of variation (CV = stddev/mean). Digunakan bareng
 * `bench-baseline` untuk memisahkan "regresi durasi" (best-of-N) dari
 * "flakiness" (p95 / variance) sebagai kegagalan berbeda.
 */

export function mean(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  let s = 0;
  for (const x of samples) s += x;
  return s / samples.length;
}

/** Sample stddev (n-1). Untuk n<2 kembalikan 0. */
export function stddev(samples: readonly number[]): number {
  const n = samples.length;
  if (n < 2) return 0;
  const m = mean(samples);
  let sq = 0;
  for (const x of samples) sq += (x - m) ** 2;
  return Math.sqrt(sq / (n - 1));
}

/** Coefficient of variation. Untuk mean=0 kembalikan 0. */
export function cv(samples: readonly number[]): number {
  const m = mean(samples);
  if (m <= 0) return 0;
  return stddev(samples) / m;
}

/**
 * Persentil linear-interpolation (tipe R7, mengikuti default Excel /
 * numpy). `p` dalam [0,100]. Bila sample kosong → 0.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  if (samples.length === 1) return samples[0]!;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const w = rank - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

export type SampleSummary = {
  n: number;
  best: number;
  worst: number;
  mean: number;
  p50: number;
  p95: number;
  stddev: number;
  cv: number;
};

export function summarize(samples: readonly number[]): SampleSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: samples.length,
    best: sorted[0] ?? 0,
    worst: sorted[sorted.length - 1] ?? 0,
    mean: mean(samples),
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    stddev: stddev(samples),
    cv: cv(samples),
  };
}
