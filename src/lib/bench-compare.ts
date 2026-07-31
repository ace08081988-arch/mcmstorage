/**
 * Pembandingan baseline vs build terbaru untuk metrik distribusi
 * (p50/p95/CV) per skenario. Berbeda dari `bench-baseline` yang
 * menentukan lulus/gagal (regresi durasi & flakiness), modul ini hanya
 * MENYAJIKAN perbandingan agar terlihat di artifact JSON dan markdown
 * ringkasan CI — trend antar-metric per scenario dalam satu tempat.
 *
 * Perhatian:
 *   - `null` baseline berarti field tersebut belum tercatat (rekomendasi:
 *     jalankan UPDATE_BENCH_BASELINE=1 sekali untuk membekukan angka
 *     saat ini sebagai baseline).
 *   - Delta persen memakai baseline sebagai pembagi; bila baseline=0 kita
 *     kembalikan `null` supaya tidak jadi Infinity.
 */

import type { BaselineFile } from "./bench-baseline";

export type MetricDelta = {
  baseline: number | null;
  current: number;
  absDelta: number | null;
  pctDelta: number | null;
};

export type CompareRow = {
  scenario: string;
  mode: "batched" | "sequential" | "unknown";
  best: MetricDelta;
  p50: MetricDelta;
  p95: MetricDelta;
  cv: MetricDelta;
  /** True bila baseline sama sekali tidak punya scenario ini. */
  noBaseline: boolean;
};

export type CompareInput = {
  scenario: string;
  mode: "batched" | "sequential";
  bestMs: number;
  p50Ms?: number;
  p95Ms?: number;
  cv?: number;
};

function delta(baseline: number | null | undefined, current: number | undefined): MetricDelta {
  const cur = current ?? 0;
  if (baseline == null || Number.isNaN(baseline)) {
    return { baseline: null, current: cur, absDelta: null, pctDelta: null };
  }
  const abs = cur - baseline;
  const pct = baseline > 0 ? (abs / baseline) * 100 : null;
  return { baseline, current: cur, absDelta: abs, pctDelta: pct };
}

export function buildCompareRow(
  input: CompareInput,
  baseline: BaselineFile | null,
): CompareRow {
  const entry = baseline?.scenarios[input.scenario];
  return {
    scenario: input.scenario,
    mode: input.mode,
    best: delta(entry?.bestMs ?? null, input.bestMs),
    p50: delta(entry?.p50Ms ?? null, input.p50Ms),
    p95: delta(entry?.p95Ms ?? null, input.p95Ms),
    cv: delta(entry?.cv ?? null, input.cv),
    noBaseline: !entry,
  };
}

export function buildCompareRows(
  inputs: readonly CompareInput[],
  baseline: BaselineFile | null,
): CompareRow[] {
  return inputs.map((i) => buildCompareRow(i, baseline));
}

// ---------- Formatting ----------

function fmtNum(x: number | null | undefined, digits = 3): string {
  if (x == null || Number.isNaN(x)) return "—";
  return x.toFixed(digits);
}

function fmtPct(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return "—";
  const s = x >= 0 ? "+" : "";
  return `${s}${x.toFixed(1)}%`;
}

/** Emoji arah tren berdasarkan pctDelta (lower-is-better untuk waktu & cv). */
function trendIcon(m: MetricDelta): string {
  if (m.baseline == null) return "⏭";
  if (m.pctDelta == null) return "—";
  // Toleransi ±2% dianggap stabil.
  if (Math.abs(m.pctDelta) <= 2) return "≈";
  return m.pctDelta > 0 ? "🔺" : "🟢";
}

export function formatCompareMarkdown(rows: readonly CompareRow[]): string {
  const out: string[] = [];
  out.push("### 📈 Baseline vs build terbaru (trend p50/p95/CV)");
  out.push("");
  if (rows.length === 0) {
    out.push("_Tidak ada scenario tercatat._");
    return out.join("\n") + "\n";
  }
  out.push(
    "Lower-is-better untuk best/p50/p95/CV. Ikon: 🟢 turun (>2%), " +
      "≈ stabil (±2%), 🔺 naik (>2%), ⏭ tanpa baseline. " +
      "Update baseline dengan `UPDATE_BENCH_BASELINE=1`.",
  );
  out.push("");
  out.push(
    "| Scenario | Mode | Best (base→now, Δ%) | p50 (base→now, Δ%) | p95 (base→now, Δ%) | CV (base→now, Δ%) |",
  );
  out.push(
    "| --- | --- | :--- | :--- | :--- | :--- |",
  );
  for (const r of rows) {
    const cell = (m: MetricDelta, digits = 3) =>
      `${trendIcon(m)} ${fmtNum(m.baseline, digits)} → ${fmtNum(m.current, digits)} (${fmtPct(m.pctDelta)})`;
    out.push(
      `| ${r.scenario} | ${r.mode} | ${cell(r.best)} | ${cell(r.p50)} | ${cell(r.p95)} | ${cell(r.cv, 3)} |`,
    );
  }
  return out.join("\n") + "\n";
}