import { describe, it, expect, vi, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeBeliDerived as realComputeDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import {
  computeBeliWarnings as realComputeWarnings,
  __resetBeliWarningsMemo,
} from "@/lib/beli-warnings";
import {
  loadBaseline,
  saveBaseline,
  checkRegression,
  shouldEnforceBaseline,
  shouldUpdateBaseline,
  type BaselineFile,
  type RegressionCheck,
} from "@/lib/bench-baseline";

// ============================================================
// Micro-benchmark untuk skenario KONFLIK LEBAR (banyak field derived +
// warnings dimutasi bertumpuk dalam 1 batch). Tujuannya menangkap
// regresi orde-magnitudo di jalur recompute — bila memoization hilang
// atau deps memo terlalu longgar, waktu eksekusi meledak.
//
// Envelope longgar (tahan noise CI, tetap sensitif thd regresi besar):
//   - budget mutlak batched  : < 40ms untuk 20 ronde × 10 field
//   - budget mutlak sequential: < 200ms untuk mutasi yang sama
//   - rasio batched/sequential: batched harus ≤ sequential × 0.6
//     (batched HARUS lebih cepat karena hanya 1 recompute).
//   - stabilitas across-runs  : best-of-N < worst-of-N × 4 (deteksi
//     variance ekstrem yg biasanya berarti GC storm / regresi memo).
// ============================================================

type Deps = readonly unknown[];
function createMemo<T>(initial: { deps: Deps; factory: () => T }) {
  let lastDeps: Deps = initial.deps;
  let lastValue: T = initial.factory();
  return {
    get value() {
      return lastValue;
    },
    commit(nextDeps: Deps, nextFactory: () => T) {
      const changed =
        nextDeps.length !== lastDeps.length ||
        nextDeps.some((d, i) => !Object.is(d, lastDeps[i]));
      if (changed) {
        lastDeps = nextDeps;
        lastValue = nextFactory();
      }
    },
  };
}

type Item = {
  id: string;
  package_type: "botol" | "gram" | "pcs" | "sachet";
  package_size: number;
  base_unit: "g" | "pcs";
  stock_base?: number;
  avg_cost_per_base?: number;
};
type Form = {
  newPackageType: BeliDerivedInput["newPackageType"];
  newPackageSize: string;
  packageQty: string;
  pricePerPackage: string;
  priceMode: "package" | "base";
  pricePerBase: string;
  inputKarton: boolean;
};

const BASE_FORM: Form = {
  newPackageType: "botol",
  newPackageSize: "500",
  packageQty: "2",
  pricePerPackage: "10000",
  priceMode: "package",
  pricePerBase: "",
  inputKarton: false,
};
const BASE_ITEM: Item = {
  id: "botol-500",
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
};

function inp(item: Item, form: Form): BeliDerivedInput {
  return {
    mode: "existing",
    selectedItem: item,
    newPackageType: form.newPackageType,
    newPackageSize: form.newPackageSize,
    packageQty: form.packageQty,
    pricePerPackage: form.pricePerPackage,
    priceMode: form.priceMode,
    pricePerBase: form.pricePerBase,
    inputKarton: form.inputKarton,
  };
}
function derivedDeps(item: Item, form: Form): Deps {
  return [
    "existing",
    item.id,
    item.package_type,
    item.package_size,
    item.base_unit,
    form.newPackageType,
    form.newPackageSize,
    form.packageQty,
    form.pricePerPackage,
    form.priceMode,
    form.pricePerBase,
    form.inputKarton,
  ] as const;
}
function warningsDeps(item: Item, form: Form, derived: unknown): Deps {
  return [
    "existing",
    item.id,
    item.package_type,
    item.package_size,
    item.base_unit,
    item.stock_base ?? 0,
    item.avg_cost_per_base ?? 0,
    form.priceMode,
    form.inputKarton,
    derived,
  ] as const;
}

type Mutation =
  | { kind: "item"; patch: Partial<Item> }
  | { kind: "form"; patch: Partial<Form> };

function buildWideConflict(rounds: number): Mutation[] {
  const list: Mutation[] = [];
  for (let r = 1; r <= rounds; r++) {
    list.push({ kind: "form", patch: { newPackageSize: String(100 + r * 50) } });
    list.push({ kind: "form", patch: { packageQty: String(1 + r) } });
    list.push({ kind: "form", patch: { pricePerPackage: String(1000 * r) } });
    list.push({ kind: "form", patch: { priceMode: r % 2 === 0 ? "package" : "base" } });
    list.push({ kind: "form", patch: { pricePerBase: String(10 * r) } });
    list.push({ kind: "form", patch: { inputKarton: r % 2 === 0 } });
    list.push({
      kind: "form",
      patch: { newPackageType: (["botol", "gram", "pcs", "sachet"] as const)[r % 4]! },
    });
    if (r % 2 === 0) {
      list.push({
        kind: "item",
        patch: { id: `gram-${r}`, package_type: "gram", package_size: 100 * r, base_unit: "g" },
      });
    } else {
      list.push({
        kind: "item",
        patch: { id: `pcs-${r}`, package_type: "pcs", package_size: r, base_unit: "pcs" },
      });
    }
    list.push({ kind: "item", patch: { stock_base: 500 * r } });
    list.push({ kind: "item", patch: { avg_cost_per_base: 7 * r } });
  }
  return list;
}

function runWide(mutations: Mutation[], mode: "batched" | "sequential") {
  __resetBeliDerivedMemo();
  __resetBeliWarningsMemo();
  const spyD = vi.fn(realComputeDerived);
  const spyW = vi.fn(realComputeWarnings);
  let item: Item = { ...BASE_ITEM };
  let form: Form = { ...BASE_FORM };

  const memoD = createMemo({
    deps: derivedDeps(item, form),
    factory: () => spyD(inp(item, form)),
  });
  const memoW = createMemo({
    deps: warningsDeps(item, form, memoD.value),
    factory: () =>
      spyW({
        mode: "existing",
        selectedItem: item,
        derived: memoD.value,
        priceMode: form.priceMode,
        inputKarton: form.inputKarton,
      }),
  });
  const initialD = spyD.mock.calls.length;
  const initialW = spyW.mock.calls.length;

  const commit = () => {
    memoD.commit(derivedDeps(item, form), () => spyD(inp(item, form)));
    memoW.commit(warningsDeps(item, form, memoD.value), () =>
      spyW({
        mode: "existing",
        selectedItem: item,
        derived: memoD.value,
        priceMode: form.priceMode,
        inputKarton: form.inputKarton,
      }),
    );
  };
  const apply = (m: Mutation) => {
    if (m.kind === "item") item = { ...item, ...m.patch };
    else form = { ...form, ...m.patch };
  };

  const t0 = performance.now();
  if (mode === "batched") {
    for (const m of mutations) apply(m);
    commit();
  } else {
    for (const m of mutations) {
      apply(m);
      commit();
    }
  }
  const ms = performance.now() - t0;

  return {
    ms,
    derivedCalls: spyD.mock.calls.length - initialD,
    warningsCalls: spyW.mock.calls.length - initialW,
  };
}

function bestOfN<T extends { ms: number }>(fn: () => T, n: number): { best: T; worst: T } {
  let best: T | null = null;
  let worst: T | null = null;
  for (let i = 0; i < n; i++) {
    const r = fn();
    if (!best || r.ms < best.ms) best = r;
    if (!worst || r.ms > worst.ms) worst = r;
  }
  return { best: best!, worst: worst! };
}

const ROUNDS = 20; // 20 × 10 = 200 mutasi bertumpuk per batch.
const MAX_MS_BATCHED = 40;
const MAX_MS_SEQUENTIAL = 200;
const BATCHED_VS_SEQ_RATIO = 0.6;
const VARIANCE_RATIO = 4;
const RUNS = 5;

// Artefak durasi untuk CI — ditulis ke `test-artifacts/` dan diunggah oleh
// workflow. Ringkasannya juga dicantumkan di GITHUB_STEP_SUMMARY.
type BenchEntry = {
  scenario: string;
  rounds: number;
  mutations: number;
  mode: "batched" | "sequential";
  bestMs: number;
  worstMs: number;
  derivedCalls: number;
  warningsCalls: number;
  budgetMs: number;
  variancePassed: boolean;
  baselineMs?: number | null;
  deltaPct?: number | null;
  regression?: boolean;
  regressionReason?: string;
};
const ARTIFACT_ENTRIES: BenchEntry[] = [];

// ----- Baseline (perbandingan persentase vs run tersimpan) -----
const BASELINE_PATH = join(process.cwd(), "benchmarks", "conflict-wide-fields.baseline.json");
const BASELINE: BaselineFile | null = loadBaseline(BASELINE_PATH);
const ENFORCE_BASELINE = shouldEnforceBaseline();
const UPDATE_BASELINE = shouldUpdateBaseline();
const REGRESSION_CHECKS: RegressionCheck[] = [];

function recordAndAssertBaseline(
  scenario: string,
  mode: "batched" | "sequential",
  bestMs: number,
  entry: BenchEntry,
): void {
  const check = checkRegression(scenario, bestMs, BASELINE);
  REGRESSION_CHECKS.push(check);
  entry.baselineMs = check.baselineMs;
  entry.deltaPct = check.deltaPct;
  entry.regression = check.regression;
  entry.regressionReason = check.reason;
  // Update baseline in memory bila diminta.
  if (UPDATE_BASELINE && BASELINE) {
    BASELINE.scenarios[scenario] = { bestMs, mode };
  }
  // Enforce hanya di CI / BENCH_STRICT=1. Lokal cukup lapor via artefak.
  if (ENFORCE_BASELINE && check.regression) {
    // Vitest akan menampilkan pesan gagal di CI dengan konteks jelas.
    throw new Error(
      `[bench:baseline] Regresi terdeteksi di scenario "${scenario}" (${mode}): ` +
        `current=${bestMs.toFixed(3)}ms vs baseline=${check.baselineMs?.toFixed(3)}ms — ${check.reason}. ` +
        `Set UPDATE_BENCH_BASELINE=1 untuk memperbarui baseline jika regresi diharapkan.`,
    );
  }
}

afterAll(() => {
  const outDir = join(process.cwd(), "test-artifacts");
  try {
    mkdirSync(outDir, { recursive: true });
    const payload = {
      generatedAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      thresholds: {
        maxMsBatched: MAX_MS_BATCHED,
        maxMsSequential: MAX_MS_SEQUENTIAL,
        batchedVsSeqRatio: BATCHED_VS_SEQ_RATIO,
        varianceRatio: VARIANCE_RATIO,
        runs: RUNS,
      },
      baseline: {
        path: "benchmarks/conflict-wide-fields.baseline.json",
        loaded: BASELINE !== null,
        capturedOn: BASELINE?.capturedOn ?? null,
        regressionPct:
          Number(process.env.BENCH_REGRESSION_PCT) || BASELINE?.regressionPctDefault || null,
        enforced: ENFORCE_BASELINE,
        updated: UPDATE_BASELINE,
        checks: REGRESSION_CHECKS,
      },
      entries: ARTIFACT_ENTRIES,
    };
    writeFileSync(
      join(outDir, "conflict-wide-fields-benchmark.json"),
      JSON.stringify(payload, null, 2),
      "utf8",
    );

    // Markdown summary — CI membaca file ini dan menyisipkan ke step summary.
    const md: string[] = [];
    md.push("### ⏱️ Conflict-wide fields benchmark");
    md.push("");
    md.push(`Node ${process.version} · ${process.platform}-${process.arch} · runs=${RUNS}`);
    if (BASELINE) {
      const pct =
        Number(process.env.BENCH_REGRESSION_PCT) || BASELINE.regressionPctDefault;
      md.push(
        `Baseline: \`${BASELINE.capturedOn ?? "unknown"}\` · ambang regresi **+${pct}%** · ` +
          `enforce=${ENFORCE_BASELINE ? "yes" : "no (report-only)"}` +
          (UPDATE_BASELINE ? " · **updating baseline**" : ""),
      );
    } else {
      md.push("Baseline: _tidak ditemukan_ — semua scenario dilaporkan `no-baseline`.");
    }
    md.push("");
    md.push(
      "| Scenario | Mode | Rounds | Muts | Best (ms) | Worst (ms) | D | W | Budget | Var | Baseline (ms) | Δ% | Status |",
    );
    md.push(
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: | ---: | ---: | :--- |",
    );
    for (const e of ARTIFACT_ENTRIES) {
      const baseCell = e.baselineMs == null ? "—" : e.baselineMs.toFixed(3);
      const deltaCell = e.deltaPct == null ? "—" : `${e.deltaPct >= 0 ? "+" : ""}${e.deltaPct.toFixed(1)}%`;
      const statusCell = e.regression ? "❌ regresi" : e.baselineMs == null ? "⏭ no-baseline" : "✅ ok";
      md.push(
        `| ${e.scenario} | ${e.mode} | ${e.rounds} | ${e.mutations} | ` +
          `${e.bestMs.toFixed(3)} | ${e.worstMs.toFixed(3)} | ${e.derivedCalls} | ${e.warningsCalls} | ` +
          `${e.budgetMs} | ${e.variancePassed ? "✅" : "❌"} | ${baseCell} | ${deltaCell} | ${statusCell} |`,
      );
    }
    writeFileSync(
      join(outDir, "conflict-wide-fields-benchmark.md"),
      md.join("\n") + "\n",
      "utf8",
    );

    // Tulis kembali baseline bila diminta secara eksplisit.
    if (UPDATE_BASELINE && BASELINE) {
      saveBaseline(BASELINE_PATH, BASELINE);
      // eslint-disable-next-line no-console
      console.info(`[bench:baseline] Baseline diperbarui: ${BASELINE_PATH}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[bench] gagal menulis artefak durasi:", err);
  }
});

describe("konflik lebar — micro-benchmark durasi recompute (regresi ambang waktu)", () => {
  it("batched: 20 ronde × 10 field selesai di bawah budget mutlak", () => {
    const mutations = buildWideConflict(ROUNDS);
    const { best, worst } = bestOfN(() => runWide(mutations, "batched"), RUNS);

    // Kontrak recompute — 1× per fungsi walau 200 mutasi konflik.
    expect(best.derivedCalls).toBe(1);
    expect(best.warningsCalls).toBe(1);

    expect(best.ms).toBeLessThan(MAX_MS_BATCHED);
    // Stabilitas: worst tidak boleh jauh > best (deteksi variance ekstrem).
    const varianceOk = worst.ms < Math.max(best.ms * VARIANCE_RATIO, MAX_MS_BATCHED);
    ARTIFACT_ENTRIES.push({
      scenario: "batched-20-rounds",
      rounds: ROUNDS,
      mutations: mutations.length,
      mode: "batched",
      bestMs: best.ms,
      worstMs: worst.ms,
      derivedCalls: best.derivedCalls,
      warningsCalls: best.warningsCalls,
      budgetMs: MAX_MS_BATCHED,
      variancePassed: varianceOk,
    });
    expect(varianceOk).toBe(true);

    // eslint-disable-next-line no-console
    console.info(
      `[bench:wide-batched] rounds=${ROUNDS} best=${best.ms.toFixed(2)}ms ` +
        `worst=${worst.ms.toFixed(2)}ms D=${best.derivedCalls} W=${best.warningsCalls}`,
    );
  });

  it("sequential: mutasi yang sama commit per-langkah tetap di bawah budget", () => {
    const mutations = buildWideConflict(ROUNDS);
    const { best, worst } = bestOfN(() => runWide(mutations, "sequential"), RUNS);

    // Sequential mengeksekusi banyak recompute (1 per commit yg berubah).
    expect(best.derivedCalls).toBeGreaterThan(1);
    expect(best.derivedCalls).toBeLessThanOrEqual(mutations.length);

    expect(best.ms).toBeLessThan(MAX_MS_SEQUENTIAL);
    const varianceOk = worst.ms < Math.max(best.ms * VARIANCE_RATIO, MAX_MS_SEQUENTIAL);
    ARTIFACT_ENTRIES.push({
      scenario: "sequential-20-rounds",
      rounds: ROUNDS,
      mutations: mutations.length,
      mode: "sequential",
      bestMs: best.ms,
      worstMs: worst.ms,
      derivedCalls: best.derivedCalls,
      warningsCalls: best.warningsCalls,
      budgetMs: MAX_MS_SEQUENTIAL,
      variancePassed: varianceOk,
    });
    expect(varianceOk).toBe(true);

    // eslint-disable-next-line no-console
    console.info(
      `[bench:wide-seq] rounds=${ROUNDS} best=${best.ms.toFixed(2)}ms ` +
        `worst=${worst.ms.toFixed(2)}ms D=${best.derivedCalls} W=${best.warningsCalls}`,
    );
  });

  it("regresi rasio: batched harus < sequential × 0.6 (memoization efektif)", () => {
    const mutations = buildWideConflict(ROUNDS);
    const seq = bestOfN(() => runWide(mutations, "sequential"), RUNS).best;
    const bat = bestOfN(() => runWide(mutations, "batched"), RUNS).best;

    // Batched harus jauh lebih cepat. +2ms floor menahan false-positive
    // di mesin sangat cepat (sequential < 1ms).
    expect(bat.ms).toBeLessThan(seq.ms * BATCHED_VS_SEQ_RATIO + 2);

    // Batched tetap 1/1 recompute; sequential > batched.
    expect(bat.derivedCalls).toBe(1);
    expect(bat.warningsCalls).toBe(1);
    expect(seq.derivedCalls).toBeGreaterThan(bat.derivedCalls);
    expect(seq.warningsCalls).toBeGreaterThan(bat.warningsCalls);

    ARTIFACT_ENTRIES.push(
      {
        scenario: "ratio-batched",
        rounds: ROUNDS,
        mutations: mutations.length,
        mode: "batched",
        bestMs: bat.ms,
        worstMs: bat.ms,
        derivedCalls: bat.derivedCalls,
        warningsCalls: bat.warningsCalls,
        budgetMs: MAX_MS_BATCHED,
        variancePassed: true,
      },
      {
        scenario: "ratio-sequential",
        rounds: ROUNDS,
        mutations: mutations.length,
        mode: "sequential",
        bestMs: seq.ms,
        worstMs: seq.ms,
        derivedCalls: seq.derivedCalls,
        warningsCalls: seq.warningsCalls,
        budgetMs: MAX_MS_SEQUENTIAL,
        variancePassed: true,
      },
    );
  });

  it("skala ronde: 4× ronde tidak boleh > 8× waktu batched (sub-kuadratik)", () => {
    // Batched → 1 recompute apapun jumlah mutasi. Kalau waktu naik
    // kuadratik terhadap jumlah ronde, memo/deps hashing bocor.
    const small = bestOfN(() => runWide(buildWideConflict(5), "batched"), RUNS).best;
    const big = bestOfN(() => runWide(buildWideConflict(20), "batched"), RUNS).best;

    const smallFloor = Math.max(small.ms, 0.5);
    expect(big.ms).toBeLessThan(smallFloor * 8 + 10);
    expect(big.derivedCalls).toBe(1);
    expect(big.warningsCalls).toBe(1);

    ARTIFACT_ENTRIES.push(
      {
        scenario: "scale-rounds-5",
        rounds: 5,
        mutations: 50,
        mode: "batched",
        bestMs: small.ms,
        worstMs: small.ms,
        derivedCalls: small.derivedCalls,
        warningsCalls: small.warningsCalls,
        budgetMs: MAX_MS_BATCHED,
        variancePassed: true,
      },
      {
        scenario: "scale-rounds-20",
        rounds: 20,
        mutations: 200,
        mode: "batched",
        bestMs: big.ms,
        worstMs: big.ms,
        derivedCalls: big.derivedCalls,
        warningsCalls: big.warningsCalls,
        budgetMs: MAX_MS_BATCHED,
        variancePassed: true,
      },
    );
  });
});