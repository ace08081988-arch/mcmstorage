/**
 * Baseline comparison untuk micro-benchmark.
 *
 * Beda dari ambang statis (mis. "batched < 40ms"), helper ini membaca
 * baseline yang disimpan (`benchmarks/*.baseline.json`) lalu memutuskan
 * regresi berbasis persentase — gagal hanya bila best-of-N run saat ini
 * melebihi baseline*(1+pct/100) DAN selisih mutlaknya lebih besar dari
 * `floorMs` (agar drift sub-ms di mesin cepat tidak jadi false positive).
 *
 * Konfigurasi env:
 *   - `BENCH_REGRESSION_PCT`  – override persen ambang (default: dari file).
 *   - `SKIP_BENCH_BASELINE=1` – nonaktifkan pembanding (unit-run lokal).
 *   - `UPDATE_BENCH_BASELINE=1` – tulis nilai run ini kembali ke file.
 *   - `BENCH_STRICT=1` atau `CI=true` – aktifkan enforce di runtime.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";

export type BaselineScenario = {
  bestMs: number;
  /** p95 baseline (opsional; hanya untuk cek flakiness). */
  p95Ms?: number;
  /** Override per-scenario untuk ambang flakiness. */
  maxCv?: number;
  p95Pct?: number;
  /** Override per-scenario untuk ambang regresi durasi (persen). */
  regressionPct?: number;
  /** Override per-scenario untuk floor selisih mutlak (ms) — menang atas `floorMs[mode]`. */
  floorMs?: number;
  mode: "batched" | "sequential";
};
export type BaselineFile = {
  _note?: string;
  capturedOn?: string;
  regressionPctDefault: number;
  floorMs: { batched: number; sequential: number };
  /** Ambang flakiness — opsional; kalau tidak ada helper pakai default. */
  flakiness?: {
    /** Ambang persen tambahan yang boleh dilewati p95 vs baseline p95. */
    p95PctDefault?: number;
    /** Batas coefficient-of-variation (stddev/mean). */
    maxCvDefault?: number;
  };
  scenarios: Record<string, BaselineScenario>;
};

export function loadBaseline(path: string): BaselineFile | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as BaselineFile;
  } catch {
    return null;
  }
}

export function saveBaseline(path: string, data: BaselineFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export type RegressionCheck = {
  scenario: string;
  currentMs: number;
  baselineMs: number | null;
  allowedMs: number;
  deltaPct: number | null;
  regression: boolean;
  reason: string;
};

export function checkRegression(
  scenario: string,
  currentMs: number,
  baseline: BaselineFile | null,
  opts: { pct?: number; floorMs?: number } = {},
): RegressionCheck {
  const entry = baseline?.scenarios[scenario];
  if (!entry || !baseline) {
    return {
      scenario,
      currentMs,
      baselineMs: null,
      allowedMs: Number.POSITIVE_INFINITY,
      deltaPct: null,
      regression: false,
      reason: "no-baseline",
    };
  }
  // Precedence: explicit opts → env override → per-scenario override → file default.
  const pct =
    opts.pct ??
    (Number(process.env.BENCH_REGRESSION_PCT) ||
      entry.regressionPct ||
      baseline.regressionPctDefault);
  const floor =
    opts.floorMs ??
    entry.floorMs ??
    baseline.floorMs[entry.mode] ??
    1;
  const allowedMs = entry.bestMs * (1 + pct / 100);
  const delta = currentMs - entry.bestMs;
  const deltaPct = entry.bestMs > 0 ? (delta / entry.bestMs) * 100 : Number.POSITIVE_INFINITY;
  // Regresi hanya bila melewati persentase DAN selisih mutlak > floor.
  const regression = currentMs > allowedMs && delta > floor;
  return {
    scenario,
    currentMs,
    baselineMs: entry.bestMs,
    allowedMs,
    deltaPct,
    regression,
    reason: regression
      ? `+${deltaPct.toFixed(1)}% (>${pct}% & Δ ${delta.toFixed(2)}ms > ${floor}ms floor)`
      : entry.bestMs > 0 && currentMs < entry.bestMs
        ? `improved ${deltaPct.toFixed(1)}%`
        : `within budget (+${deltaPct.toFixed(1)}%, floor ${floor}ms)`,
  };
}

/**
 * Baseline enforce hanya di CI atau saat BENCH_STRICT=1 — dev lokal
 * sering di mesin lebih lambat/cepat drastis, jadi jangan gagalkan.
 * `SKIP_BENCH_BASELINE=1` override untuk mematikan sepenuhnya.
 */
export function shouldEnforceBaseline(): boolean {
  if (process.env.SKIP_BENCH_BASELINE === "1") return false;
  if (process.env.BENCH_STRICT === "1") return true;
  return process.env.CI === "true" || process.env.CI === "1";
}

export function shouldUpdateBaseline(): boolean {
  return process.env.UPDATE_BENCH_BASELINE === "1";
}

// ============================================================
// Flakiness — dipisah dari regresi durasi.
// Aturan gagal (ENFORCE_BASELINE):
//   - p95 > baseline.p95Ms * (1 + p95Pct/100) DAN Δ > floorMs (mode)
//   - ATAU cv > maxCv
// ============================================================

export type FlakinessCheck = {
  scenario: string;
  mode?: "batched" | "sequential";
  p95Ms: number;
  baselineP95Ms: number | null;
  allowedP95Ms: number | null;
  p95DeltaPct: number | null;
  p95AbsDeltaMs: number | null;
  p95Pct: number;
  floorMs: number | null;
  cv: number;
  maxCv: number;
  p95GuardTripped: boolean;
  cvGuardTripped: boolean;
  floorGuardBlocked: boolean;
  flaky: boolean;
  reasons: string[];
};

const DEFAULT_P95_PCT = 100;
const DEFAULT_MAX_CV = 1.0;

export function checkFlakiness(
  scenario: string,
  stats: { p95: number; cv: number },
  baseline: BaselineFile | null,
  opts: { p95Pct?: number; maxCv?: number } = {},
): FlakinessCheck {
  const entry = baseline?.scenarios[scenario];
  const p95Pct =
    opts.p95Pct ??
    entry?.p95Pct ??
    (Number(process.env.BENCH_P95_PCT) ||
      baseline?.flakiness?.p95PctDefault ||
      DEFAULT_P95_PCT);
  const maxCv =
    opts.maxCv ??
    entry?.maxCv ??
    (Number(process.env.BENCH_MAX_CV) ||
      baseline?.flakiness?.maxCvDefault ||
      DEFAULT_MAX_CV);

  const reasons: string[] = [];
  let p95Regression = false;
  let baselineP95: number | null = null;
  let allowedP95: number | null = null;
  let p95DeltaPct: number | null = null;
  let p95AbsDelta: number | null = null;
  let floorGuardBlocked = false;
  let floor: number | null = null;

  if (entry?.p95Ms != null && baseline) {
    baselineP95 = entry.p95Ms;
    allowedP95 = entry.p95Ms * (1 + p95Pct / 100);
    const delta = stats.p95 - entry.p95Ms;
    p95AbsDelta = delta;
    p95DeltaPct = entry.p95Ms > 0 ? (delta / entry.p95Ms) * 100 : Number.POSITIVE_INFINITY;
    floor = entry.floorMs ?? baseline.floorMs[entry.mode] ?? 1;
    const overAllowed = stats.p95 > allowedP95;
    if (overAllowed && delta > floor) {
      p95Regression = true;
      reasons.push(
        `p95=${stats.p95.toFixed(2)}ms > baseline·(1+${p95Pct}%)=${allowedP95.toFixed(2)}ms ` +
          `(Δ ${delta.toFixed(2)}ms > floor ${floor}ms)`,
      );
    } else if (overAllowed && delta <= floor) {
      // p95 melewati ambang persen, tapi diselamatkan oleh floor guard.
      floorGuardBlocked = true;
    }
  }

  const highCv = stats.cv > maxCv;
  if (highCv) {
    reasons.push(`cv=${stats.cv.toFixed(3)} > maxCv=${maxCv}`);
  }

  return {
    scenario,
    mode: entry?.mode,
    p95Ms: stats.p95,
    baselineP95Ms: baselineP95,
    allowedP95Ms: allowedP95,
    p95DeltaPct,
    p95AbsDeltaMs: p95AbsDelta,
    p95Pct,
    floorMs: floor,
    cv: stats.cv,
    maxCv,
    p95GuardTripped: p95Regression,
    cvGuardTripped: highCv,
    floorGuardBlocked,
    flaky: p95Regression || highCv,
    reasons,
  };
}
