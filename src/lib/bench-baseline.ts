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

export type BaselineScenario = { bestMs: number; mode: "batched" | "sequential" };
export type BaselineFile = {
  _note?: string;
  capturedOn?: string;
  regressionPctDefault: number;
  floorMs: { batched: number; sequential: number };
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
  opts: { pct?: number } = {},
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
  const pct = opts.pct ?? Number(process.env.BENCH_REGRESSION_PCT) || baseline.regressionPctDefault;
  const floor = baseline.floorMs[entry.mode] ?? 1;
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
