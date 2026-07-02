/**
 * Histogram / distribusi sampel untuk micro-benchmark.
 *
 * Tujuan: memberi konteks visual di artifact CI supaya kita bisa melihat
 * sebaran durasi tiap scenario, di mana p50/p95 berada, dan berapa banyak
 * outlier di ekor kanan — bukan sekedar angka best/worst.
 *
 * Zero-dependency: bin count pakai heuristik `max(5, ceil(sqrt(n)))` yang
 * cocok untuk n=15–100 (jumlah RUNS di benchmark ini) tanpa
 * ketergantungan pada distribusi.
 */

import { percentile } from "./bench-stats";

export type HistogramBin = {
  /** Batas bawah (inklusif) bin dalam ms. */
  lo: number;
  /** Batas atas (eksklusif untuk bin non-terakhir, inklusif untuk bin terakhir). */
  hi: number;
  /** Jumlah sample yang jatuh di bin ini. */
  count: number;
};

export type HistogramSummary = {
  scenario: string;
  mode: string;
  n: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  binWidth: number;
  bins: HistogramBin[];
  /** Sample > p95 dianggap outlier ekor kanan (max ~5% dari n). */
  outliers: number[];
};

function chooseBinCount(n: number): number {
  if (n <= 1) return 1;
  return Math.max(5, Math.ceil(Math.sqrt(n)));
}

export function buildHistogram(
  scenario: string,
  mode: string,
  samples: readonly number[],
): HistogramSummary {
  const n = samples.length;
  if (n === 0) {
    return {
      scenario, mode, n: 0, min: 0, max: 0, p50: 0, p95: 0,
      binWidth: 0, bins: [], outliers: [],
    };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const binCount = chooseBinCount(n);
  // Semua sample identik → satu bin tunggal.
  if (max <= min) {
    return {
      scenario, mode, n, min, max, p50, p95,
      binWidth: 0,
      bins: [{ lo: min, hi: min, count: n }],
      outliers: [],
    };
  }
  const binWidth = (max - min) / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    lo: min + i * binWidth,
    hi: i === binCount - 1 ? max : min + (i + 1) * binWidth,
    count: 0,
  }));
  for (const x of samples) {
    // Bin index dengan proteksi terhadap floating-point drift di batas.
    let idx = Math.floor((x - min) / binWidth);
    if (idx < 0) idx = 0;
    if (idx >= binCount) idx = binCount - 1;
    bins[idx]!.count++;
  }
  const outliers = sorted.filter((x) => x > p95);
  return { scenario, mode, n, min, max, p50, p95, binWidth, bins, outliers };
}

/** Render 1 histogram sebagai markdown code-block dengan bar ASCII. */
export function formatHistogramBlock(h: HistogramSummary, opts: { width?: number } = {}): string {
  const width = Math.max(8, opts.width ?? 32);
  if (h.n === 0) return `_${h.scenario} (${h.mode}) — tidak ada sample._`;
  const maxCount = h.bins.reduce((m, b) => Math.max(m, b.count), 0) || 1;
  const lines: string[] = [];
  lines.push(
    `**${h.scenario}** (${h.mode}) — n=${h.n}, ` +
      `min=${h.min.toFixed(3)}ms · p50=${h.p50.toFixed(3)}ms · ` +
      `p95=${h.p95.toFixed(3)}ms · max=${h.max.toFixed(3)}ms · ` +
      `outliers>p95=${h.outliers.length}`,
  );
  lines.push("```");
  for (const b of h.bins) {
    const bar = "█".repeat(Math.round((b.count / maxCount) * width));
    const marker =
      h.p95 >= b.lo && h.p95 <= b.hi ? " ← p95" :
      h.p50 >= b.lo && h.p50 <= b.hi ? " ← p50" : "";
    lines.push(
      `${b.lo.toFixed(3).padStart(7)}–${b.hi.toFixed(3).padStart(7)}ms │ ` +
        `${bar.padEnd(width)} ${String(b.count).padStart(3)}${marker}`,
    );
  }
  if (h.outliers.length > 0) {
    lines.push(
      `outliers (>p95): ${h.outliers.map((x) => x.toFixed(3)).join(", ")}`,
    );
  }
  lines.push("```");
  return lines.join("\n");
}

export function formatHistogramMarkdown(histograms: readonly HistogramSummary[]): string {
  const out: string[] = [];
  out.push("### 📊 Distribusi sampel durasi (histogram)");
  out.push("");
  if (histograms.length === 0) {
    out.push("_Tidak ada scenario tercatat._");
    return out.join("\n") + "\n";
  }
  out.push(
    "Bin count = `max(5, ⌈√n⌉)`. Bar = jumlah sample di bin, " +
      "penanda `← p50`/`← p95` menandai bin tempat persentil jatuh. " +
      "Outlier didefinisikan sebagai sample strictly di atas p95.",
  );
  out.push("");
  for (const h of histograms) {
    out.push(formatHistogramBlock(h));
    out.push("");
  }
  return out.join("\n");
}