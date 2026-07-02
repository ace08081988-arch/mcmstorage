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
