import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadBaseline,
  saveBaseline,
  checkRegression,
  checkFlakiness,
  shouldEnforceBaseline,
  shouldUpdateBaseline,
  type BaselineFile,
} from "./bench-baseline";

const BASE: BaselineFile = {
  capturedOn: "test",
  regressionPctDefault: 50,
  floorMs: { batched: 2, sequential: 5 },
  flakiness: { p95PctDefault: 100, maxCvDefault: 1.0 },
  scenarios: {
    a: { bestMs: 10, p95Ms: 20, mode: "batched" },
    b: { bestMs: 100, p95Ms: 150, mode: "sequential" },
  },
};

describe("bench-baseline", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.BENCH_REGRESSION_PCT;
    delete process.env.SKIP_BENCH_BASELINE;
    delete process.env.UPDATE_BENCH_BASELINE;
    delete process.env.BENCH_STRICT;
    delete process.env.CI;
    delete process.env.BENCH_P95_PCT;
    delete process.env.BENCH_MAX_CV;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("melapor no-baseline saat file/scenario tidak ada", () => {
    expect(checkRegression("x", 1, null).regression).toBe(false);
    expect(checkRegression("x", 1, null).reason).toBe("no-baseline");
    expect(checkRegression("missing", 1, BASE).baselineMs).toBeNull();
  });

  it("tidak menandai regresi bila di bawah persentase ambang", () => {
    // 10ms → 14ms = +40% (default 50% → aman)
    const c = checkRegression("a", 14, BASE);
    expect(c.regression).toBe(false);
    expect(c.deltaPct).toBeCloseTo(40, 0);
  });

  it("menandai regresi bila > pct DAN delta > floor", () => {
    // 10ms → 20ms = +100%, delta 10 > floor 2 → regresi
    const c = checkRegression("a", 20, BASE);
    expect(c.regression).toBe(true);
    expect(c.reason).toContain("+100.0%");
  });

  it("mengabaikan regresi persen bila selisih mutlak < floor", () => {
    // sequential baseline 100ms, floor 5ms. current 104 = +4%, tapi delta 4 < floor 5
    // pakai pct super kecil untuk memaksa "melewati pct":
    const c = checkRegression("b", 104, BASE, { pct: 1 });
    // +4% melewati 1%, tapi delta 4 < floor 5 → BUKAN regresi
    expect(c.regression).toBe(false);
  });

  it("override pct via env", () => {
    process.env.BENCH_REGRESSION_PCT = "10";
    // 10 → 12 = +20% > 10%, delta 2 = floor (butuh > floor, jadi tidak regresi)
    expect(checkRegression("a", 12, BASE).regression).toBe(false);
    // 10 → 13 = +30%, delta 3 > floor 2 → regresi
    expect(checkRegression("a", 13, BASE).regression).toBe(true);
  });

  it("shouldEnforceBaseline: SKIP menang, lalu STRICT/CI", () => {
    expect(shouldEnforceBaseline()).toBe(false);
    process.env.CI = "true";
    expect(shouldEnforceBaseline()).toBe(true);
    process.env.SKIP_BENCH_BASELINE = "1";
    expect(shouldEnforceBaseline()).toBe(false);
    delete process.env.SKIP_BENCH_BASELINE;
    delete process.env.CI;
    process.env.BENCH_STRICT = "1";
    expect(shouldEnforceBaseline()).toBe(true);
  });

  it("shouldUpdateBaseline hanya saat env=1", () => {
    expect(shouldUpdateBaseline()).toBe(false);
    process.env.UPDATE_BENCH_BASELINE = "1";
    expect(shouldUpdateBaseline()).toBe(true);
  });

  it("load / save roundtrip", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-"));
    const path = join(dir, "b.json");
    try {
      expect(loadBaseline(path)).toBeNull();
      saveBaseline(path, BASE);
      expect(existsSync(path)).toBe(true);
      const loaded = loadBaseline(path);
      expect(loaded?.scenarios.a.bestMs).toBe(10);
      expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("checkFlakiness", () => {
  it("no-baseline: hanya cek CV", () => {
    const c = checkFlakiness("x", { p95: 100, cv: 0.5 }, null);
    expect(c.flaky).toBe(false);
    expect(c.baselineP95Ms).toBeNull();
  });

  it("baseline tanpa p95Ms: skip p95 check, cek CV saja", () => {
    const b: BaselineFile = { ...BASE, scenarios: { z: { bestMs: 10, mode: "batched" } } };
    const c = checkFlakiness("z", { p95: 999, cv: 0.2 }, b);
    expect(c.flaky).toBe(false);
    expect(c.baselineP95Ms).toBeNull();
  });

  it("flaky karena p95 melewati ambang persen + floor", () => {
    // baseline p95=20, allow +100% → 40. delta > floor 2 wajib.
    const c = checkFlakiness("a", { p95: 50, cv: 0.1 }, BASE);
    expect(c.flaky).toBe(true);
    expect(c.reasons.some((r) => r.includes("p95="))).toBe(true);
  });

  it("p95 lewat pct tapi delta < floor → tidak flaky", () => {
    // baseline p95=20, pct=1 → allow 20.2; current 21 → delta 1 < floor 2
    const c = checkFlakiness("a", { p95: 21, cv: 0.1 }, BASE, { p95Pct: 1 });
    expect(c.flaky).toBe(false);
  });

  it("flaky karena cv terlalu tinggi", () => {
    const c = checkFlakiness("a", { p95: 20, cv: 1.5 }, BASE);
    expect(c.flaky).toBe(true);
    expect(c.reasons.some((r) => r.includes("cv="))).toBe(true);
  });

  it("override via env: BENCH_MAX_CV", () => {
    process.env.BENCH_MAX_CV = "0.3";
    const c = checkFlakiness("a", { p95: 20, cv: 0.5 }, BASE);
    expect(c.flaky).toBe(true);
  });

  it("override via env: BENCH_P95_PCT", () => {
    process.env.BENCH_P95_PCT = "10";
    // allow 20*1.1=22. current 30 → delta 10 > floor 2 → flaky
    const c = checkFlakiness("a", { p95: 30, cv: 0.1 }, BASE);
    expect(c.flaky).toBe(true);
  });

  it("gabungan kedua alasan dilaporkan", () => {
    const c = checkFlakiness("a", { p95: 100, cv: 2.0 }, BASE);
    expect(c.flaky).toBe(true);
    expect(c.reasons.length).toBe(2);
  });
});
