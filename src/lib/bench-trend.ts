/**
 * Trend recording untuk micro-benchmark durasi.
 *
 * Setelah tiap run benchmark, satu baris JSON diappend ke file
 * `benchmarks/*.trend.jsonl`. Riwayat ini dibaca lagi untuk merangkum
 * arah tren (membaik / memburuk / stabil) per-scenario terhadap baseline
 * dari run-ke-run — bukan hanya perbandingan snapshot vs baseline statis.
 *
 * Format JSONL dipilih karena:
 *   - append O(1) tanpa parse seluruh histori,
 *   - satu run = satu baris → gampang di-`tail`/`grep` di CI,
 *   - file rusak parsial masih bisa dibaca sebagian (baris rusak dilewati).
 *
 * Env:
 *   - `BENCH_TREND_MAX`  batas jumlah run yang disimpan (default 50).
 *   - `BENCH_TREND_WINDOW` jumlah run terbaru untuk ringkasan (default 10).
 *   - `BENCH_TREND_DIR_PCT` ambang persen untuk klasifikasi arah (default 5).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type TrendScenarioSample = {
  mode: "batched" | "sequential";
  bestMs: number;
  p95Ms?: number | null;
  meanMs?: number | null;
  cv?: number | null;
  baselineMs?: number | null;
  deltaPct?: number | null;
  baselineP95Ms?: number | null;
  p95DeltaPct?: number | null;
  regression?: boolean;
  flaky?: boolean;
};

export type TrendRun = {
  runAt: string;
  node: string;
  platform: string;
  commit?: string | null;
  ref?: string | null;
  runId?: string | null;
  scenarios: Record<string, TrendScenarioSample>;
};

export type TrendDirection = "improving" | "worsening" | "stable";

export type TrendScenarioSummary = {
  scenario: string;
  mode: "batched" | "sequential";
  runs: number;
  firstBestMs: number;
  lastBestMs: number;
  minBestMs: number;
  maxBestMs: number;
  meanBestMs: number;
  /** Perubahan persen best terbaru vs best pertama di window. */
  trendPct: number;
  /** Slope linear (ms per-run) — memperhalus noise vs first/last saja. */
  slopeMsPerRun: number;
  direction: TrendDirection;
  /** Persentase run pada window yang menandai regresi/flaky. */
  regressionRate: number;
  flakyRate: number;
  /** Selisih vs baseline terbaru — bila tersedia. */
  lastDeltaPct?: number | null;
};

export type TrendSummary = {
  window: number;
  totalRuns: number;
  directionPct: number;
  scenarios: TrendScenarioSummary[];
};

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function appendTrendRun(path: string, run: TrendRun, maxRuns?: number): void {
  ensureDir(path);
  const line = JSON.stringify(run) + "\n";
  appendFileSync(path, line, "utf8");
  const limit =
    maxRuns ?? Number(process.env.BENCH_TREND_MAX) || 50;
  if (limit > 0) trimTrendFile(path, limit);
}

export function loadTrendHistory(path: string, limit?: number): TrendRun[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const parsed: TrendRun[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as TrendRun;
      if (obj && typeof obj === "object" && obj.scenarios) parsed.push(obj);
    } catch {
      // Lewati baris rusak; jangan gagalkan CI karena JSONL sebagian rusak.
    }
  }
  if (limit && limit > 0 && parsed.length > limit) {
    return parsed.slice(parsed.length - limit);
  }
  return parsed;
}

export function trimTrendFile(path: string, maxRuns: number): void {
  const history = loadTrendHistory(path);
  if (history.length <= maxRuns) return;
  const kept = history.slice(history.length - maxRuns);
  writeFileSync(path, kept.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export function summarizeTrend(history: TrendRun[], opts?: {
  window?: number;
  directionPct?: number;
}): TrendSummary {
  const window =
    opts?.window ?? Number(process.env.BENCH_TREND_WINDOW) || 10;
  const directionPct =
    opts?.directionPct ?? Number(process.env.BENCH_TREND_DIR_PCT) || 5;
  const slice = history.slice(-window);
  const scenarioNames = new Set<string>();
  for (const run of slice) {
    for (const name of Object.keys(run.scenarios)) scenarioNames.add(name);
  }
  const scenarios: TrendScenarioSummary[] = [];
  for (const name of Array.from(scenarioNames).sort()) {
    const points: Array<{ sample: TrendScenarioSample }> = [];
    for (const run of slice) {
      const s = run.scenarios[name];
      if (s && typeof s.bestMs === "number" && Number.isFinite(s.bestMs)) {
        points.push({ sample: s });
      }
    }
    if (points.length === 0) continue;
    const bests = points.map((p) => p.sample.bestMs);
    const first = bests[0];
    const last = bests[bests.length - 1];
    const min = Math.min(...bests);
    const max = Math.max(...bests);
    const mean = bests.reduce((s, v) => s + v, 0) / bests.length;
    const trendPct = first > 0 ? ((last - first) / first) * 100 : 0;
    const slope = linearSlope(bests);
    let direction: TrendDirection = "stable";
    if (trendPct <= -directionPct) direction = "improving";
    else if (trendPct >= directionPct) direction = "worsening";
    const regs = points.filter((p) => p.sample.regression === true).length;
    const flakies = points.filter((p) => p.sample.flaky === true).length;
    const lastSample = points[points.length - 1].sample;
    scenarios.push({
      scenario: name,
      mode: lastSample.mode,
      runs: points.length,
      firstBestMs: first,
      lastBestMs: last,
      minBestMs: min,
      maxBestMs: max,
      meanBestMs: mean,
      trendPct,
      slopeMsPerRun: slope,
      direction,
      regressionRate: regs / points.length,
      flakyRate: flakies / points.length,
      lastDeltaPct: lastSample.deltaPct ?? null,
    });
  }
  return { window, totalRuns: history.length, directionPct, scenarios };
}

export function formatTrendMarkdown(summary: TrendSummary): string {
  const md: string[] = [];
  md.push("### 📈 Benchmark trend");
  md.push("");
  md.push(
    `Window: **${summary.window} run terakhir** dari total ${summary.totalRuns} · ` +
      `ambang arah ±${summary.directionPct}%`,
  );
  md.push("");
  if (summary.scenarios.length === 0) {
    md.push("_Belum ada histori — jalankan benchmark minimal 2× untuk melihat tren._");
    return md.join("\n") + "\n";
  }
  md.push(
    "| Scenario | Mode | Runs | First | Last | Min | Max | Mean | Trend % | Slope ms/run | Regresi | Flaky | Arah |",
  );
  md.push(
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |",
  );
  const icon: Record<TrendDirection, string> = {
    improving: "🟢 membaik",
    worsening: "🔴 memburuk",
    stable: "⚪️ stabil",
  };
  for (const s of summary.scenarios) {
    md.push(
      `| ${s.scenario} | ${s.mode} | ${s.runs} | ` +
        `${s.firstBestMs.toFixed(3)} | ${s.lastBestMs.toFixed(3)} | ` +
        `${s.minBestMs.toFixed(3)} | ${s.maxBestMs.toFixed(3)} | ${s.meanBestMs.toFixed(3)} | ` +
        `${s.trendPct >= 0 ? "+" : ""}${s.trendPct.toFixed(1)}% | ` +
        `${s.slopeMsPerRun >= 0 ? "+" : ""}${s.slopeMsPerRun.toFixed(4)} | ` +
        `${(s.regressionRate * 100).toFixed(0)}% | ${(s.flakyRate * 100).toFixed(0)}% | ` +
        `${icon[s.direction]} |`,
    );
  }
  return md.join("\n") + "\n";
}

/** Bangun `TrendRun` dari daftar entri yang dipakai artefak benchmark. */
export function buildTrendRun(
  entries: ReadonlyArray<{
    scenario: string;
    mode: "batched" | "sequential";
    bestMs: number;
    p95Ms?: number;
    meanMs?: number;
    cv?: number;
    baselineMs?: number | null;
    deltaPct?: number | null;
    baselineP95Ms?: number | null;
    p95DeltaPct?: number | null;
    regression?: boolean;
    flaky?: boolean;
  }>,
): TrendRun {
  const scenarios: Record<string, TrendScenarioSample> = {};
  for (const e of entries) {
    scenarios[e.scenario] = {
      mode: e.mode,
      bestMs: e.bestMs,
      p95Ms: e.p95Ms ?? null,
      meanMs: e.meanMs ?? null,
      cv: e.cv ?? null,
      baselineMs: e.baselineMs ?? null,
      deltaPct: e.deltaPct ?? null,
      baselineP95Ms: e.baselineP95Ms ?? null,
      p95DeltaPct: e.p95DeltaPct ?? null,
      regression: e.regression ?? false,
      flaky: e.flaky ?? false,
    };
  }
  return {
    runAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    commit:
      process.env.GITHUB_SHA ||
      process.env.COMMIT_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      null,
    ref:
      process.env.GITHUB_REF_NAME ||
      process.env.GITHUB_REF ||
      null,
    runId: process.env.GITHUB_RUN_ID || null,
    scenarios,
  };
}