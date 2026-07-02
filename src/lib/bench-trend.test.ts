import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendTrendRun,
  buildTrendRun,
  formatTrendMarkdown,
  loadTrendHistory,
  summarizeTrend,
  trimTrendFile,
  type TrendRun,
} from "./bench-trend";

function makeRun(bestMs: number, extras: Partial<TrendRun["scenarios"][string]> = {}): TrendRun {
  return {
    runAt: new Date().toISOString(),
    node: "vX",
    platform: "test",
    scenarios: {
      "ratio-batched": { mode: "batched", bestMs, ...extras },
    },
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bench-trend-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("bench-trend", () => {
  it("append + load JSONL roundtrip", () => {
    const path = join(dir, "t.jsonl");
    appendTrendRun(path, makeRun(1.2));
    appendTrendRun(path, makeRun(1.3));
    const history = loadTrendHistory(path);
    expect(history).toHaveLength(2);
    expect(history[0].scenarios["ratio-batched"].bestMs).toBe(1.2);
  });

  it("skips corrupt lines gracefully", () => {
    const path = join(dir, "t.jsonl");
    appendTrendRun(path, makeRun(1.0));
    // Corrupt the file with a broken line in the middle.
    const raw = readFileSync(path, "utf8");
    require("node:fs").writeFileSync(path, raw + "not-json\n", "utf8");
    appendTrendRun(path, makeRun(1.1));
    const history = loadTrendHistory(path);
    expect(history).toHaveLength(2);
  });

  it("trim keeps only the latest N runs", () => {
    const path = join(dir, "t.jsonl");
    for (let i = 0; i < 8; i++) appendTrendRun(path, makeRun(i + 1));
    trimTrendFile(path, 3);
    const history = loadTrendHistory(path);
    expect(history).toHaveLength(3);
    expect(history[0].scenarios["ratio-batched"].bestMs).toBe(6);
    expect(history[2].scenarios["ratio-batched"].bestMs).toBe(8);
  });

  it("appendTrendRun honors maxRuns cap", () => {
    const path = join(dir, "t.jsonl");
    for (let i = 0; i < 10; i++) appendTrendRun(path, makeRun(i + 1), 4);
    expect(loadTrendHistory(path)).toHaveLength(4);
  });

  it("summarize classifies improving/worsening/stable via directionPct", () => {
    const worsening = [10, 10.5, 11, 12].map((v) => makeRun(v));
    const s1 = summarizeTrend(worsening, { window: 4, directionPct: 5 });
    expect(s1.scenarios[0].direction).toBe("worsening");
    expect(s1.scenarios[0].trendPct).toBeGreaterThan(0);
    expect(s1.scenarios[0].slopeMsPerRun).toBeGreaterThan(0);

    const improving = [10, 9, 8, 7].map((v) => makeRun(v));
    const s2 = summarizeTrend(improving, { window: 4, directionPct: 5 });
    expect(s2.scenarios[0].direction).toBe("improving");
    expect(s2.scenarios[0].slopeMsPerRun).toBeLessThan(0);

    const stable = [10, 10.1, 10.05, 10.2].map((v) => makeRun(v));
    const s3 = summarizeTrend(stable, { window: 4, directionPct: 5 });
    expect(s3.scenarios[0].direction).toBe("stable");
  });

  it("summarize computes min/max/mean and regression/flaky rate", () => {
    const history: TrendRun[] = [
      makeRun(1.0, { regression: false, flaky: false }),
      makeRun(2.0, { regression: true, flaky: false }),
      makeRun(3.0, { regression: false, flaky: true }),
      makeRun(4.0, { regression: true, flaky: true }),
    ];
    const s = summarizeTrend(history, { window: 4, directionPct: 5 });
    const row = s.scenarios[0];
    expect(row.runs).toBe(4);
    expect(row.minBestMs).toBe(1);
    expect(row.maxBestMs).toBe(4);
    expect(row.meanBestMs).toBeCloseTo(2.5, 5);
    expect(row.regressionRate).toBeCloseTo(0.5, 5);
    expect(row.flakyRate).toBeCloseTo(0.5, 5);
  });

  it("summarize window limits to last N runs", () => {
    const history: TrendRun[] = [];
    for (let i = 1; i <= 20; i++) history.push(makeRun(i));
    const s = summarizeTrend(history, { window: 5, directionPct: 5 });
    expect(s.scenarios[0].runs).toBe(5);
    expect(s.scenarios[0].firstBestMs).toBe(16);
    expect(s.scenarios[0].lastBestMs).toBe(20);
  });

  it("buildTrendRun serializes benchmark entries with sane defaults", () => {
    const run = buildTrendRun([
      {
        scenario: "ratio-batched",
        mode: "batched",
        bestMs: 1.5,
        p95Ms: 2.1,
        meanMs: 1.7,
        cv: 0.1,
      },
    ]);
    expect(run.scenarios["ratio-batched"].bestMs).toBe(1.5);
    expect(run.scenarios["ratio-batched"].regression).toBe(false);
    expect(run.scenarios["ratio-batched"].flaky).toBe(false);
  });

  it("formatTrendMarkdown renders headers and rows", () => {
    const history = [makeRun(1), makeRun(2), makeRun(3)];
    const md = formatTrendMarkdown(summarizeTrend(history));
    expect(md).toContain("Benchmark trend");
    expect(md).toContain("ratio-batched");
    expect(md).toMatch(/memburuk|membaik|stabil/);
  });

  it("formatTrendMarkdown handles empty history", () => {
    const md = formatTrendMarkdown(summarizeTrend([]));
    expect(md).toContain("Belum ada histori");
  });

  it("loadTrendHistory returns [] for missing file", () => {
    expect(loadTrendHistory(join(dir, "missing.jsonl"))).toEqual([]);
    expect(existsSync(join(dir, "missing.jsonl"))).toBe(false);
  });
});