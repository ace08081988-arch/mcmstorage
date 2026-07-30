import { describe, it, expect } from "vitest";
import { mean, stddev, cv, percentile, summarize } from "./bench-stats";

describe("bench-stats", () => {
  it("mean/stddev/cv basic", () => {
    expect(mean([])).toBe(0);
    expect(mean([2, 4, 6])).toBe(4);
    expect(stddev([2, 4, 6])).toBeCloseTo(2, 5);
    expect(stddev([5])).toBe(0);
    expect(cv([2, 4, 6])).toBeCloseTo(0.5, 5);
    expect(cv([0, 0, 0])).toBe(0);
  });

  it("percentile R7 interpolasi", () => {
    const s = [1, 2, 3, 4, 5];
    expect(percentile(s, 0)).toBe(1);
    expect(percentile(s, 100)).toBe(5);
    expect(percentile(s, 50)).toBe(3);
    // rank untuk p=25 di n=5: (0.25*4)=1 → index 1 → 2
    expect(percentile(s, 25)).toBe(2);
    // rank p=95: 0.95*4=3.8 → interp antara idx3(4) & idx4(5): 4*.2+5*.8=4.8
    expect(percentile(s, 95)).toBeCloseTo(4.8, 5);
  });

  it("summarize agregat", () => {
    const s = summarize([3, 1, 2, 5, 4]);
    expect(s.n).toBe(5);
    expect(s.best).toBe(1);
    expect(s.worst).toBe(5);
    expect(s.p50).toBe(3);
    expect(s.p95).toBeCloseTo(4.8, 5);
    expect(s.mean).toBe(3);
    expect(s.stddev).toBeCloseTo(Math.sqrt(2.5), 5);
    expect(s.cv).toBeCloseTo(Math.sqrt(2.5) / 3, 5);
  });

  it("summarize tidak mengubah input", () => {
    const s = [5, 1, 3];
    summarize(s);
    expect(s).toEqual([5, 1, 3]);
  });
});
