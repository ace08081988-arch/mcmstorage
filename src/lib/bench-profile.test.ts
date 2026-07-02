import { describe, it, expect, beforeEach } from "vitest";
import { createProfiler, isProfilingEnabled, formatProfileMarkdown } from "./bench-profile";

describe("createProfiler", () => {
  it("no-op wrapper saat disabled: return fn asli", () => {
    const p = createProfiler(false);
    const fn = (a: number, b: number) => a + b;
    const w = p.wrap("add", fn);
    expect(w).toBe(fn);
    expect(w(2, 3)).toBe(5);
    const r = p.finalize("s", "batched", 1);
    expect(r.records).toEqual([]);
    expect(r.bottlenecks).toEqual([]);
  });

  it("mencatat durasi per-call saat enabled", () => {
    const p = createProfiler(true);
    const fn = (n: number) => n * 2;
    const w = p.wrap("dbl", fn);
    for (let i = 0; i < 3; i++) w(i);
    const r = p.finalize("scenA", "batched", 10);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]!.name).toBe("dbl");
    expect(r.records[0]!.durations).toHaveLength(3);
    expect(r.bottlenecks[0]!.calls).toBe(3);
    expect(r.bottlenecks[0]!.sharePct).toBeGreaterThanOrEqual(0);
    expect(r.bottlenecks[0]!.sharePct).toBeLessThanOrEqual(100);
  });

  it("bottleneck disortir turun berdasarkan totalMs", () => {
    const p = createProfiler(true);
    const slow = p.wrap("slow", () => {
      const end = performance.now() + 2;
      while (performance.now() < end) {
        /* busy */
      }
    });
    const fast = p.wrap("fast", () => 1);
    fast();
    slow();
    fast();
    slow();
    const r = p.finalize("s", "batched", 100);
    expect(r.bottlenecks[0]!.name).toBe("slow");
    expect(r.bottlenecks[1]!.name).toBe("fast");
    expect(r.bottlenecks[0]!.totalMs).toBeGreaterThan(r.bottlenecks[1]!.totalMs);
  });

  it("mencatat durasi meski fn throw", () => {
    const p = createProfiler(true);
    const bad = p.wrap("bad", () => {
      throw new Error("x");
    });
    expect(() => bad()).toThrow();
    const r = p.finalize("s", "batched", 1);
    expect(r.records[0]!.durations).toHaveLength(1);
  });

  it("totalMs=0 → sharePct=0 tanpa NaN", () => {
    const p = createProfiler(true);
    p.wrap("a", () => 1)();
    const r = p.finalize("s", "batched", 0);
    expect(r.bottlenecks[0]!.sharePct).toBe(0);
  });
});

describe("isProfilingEnabled", () => {
  it("mendeteksi berbagai bentuk truthy", () => {
    expect(isProfilingEnabled({ BENCH_PROFILE: "1" })).toBe(true);
    expect(isProfilingEnabled({ BENCH_PROFILE: "true" })).toBe(true);
    expect(isProfilingEnabled({ BENCH_PROFILE: "yes" })).toBe(true);
    expect(isProfilingEnabled({ BENCH_PROFILE: "TRUE" })).toBe(true);
  });
  it("falsy / kosong / undefined → false", () => {
    expect(isProfilingEnabled({})).toBe(false);
    expect(isProfilingEnabled({ BENCH_PROFILE: "" })).toBe(false);
    expect(isProfilingEnabled({ BENCH_PROFILE: "0" })).toBe(false);
    expect(isProfilingEnabled({ BENCH_PROFILE: "no" })).toBe(false);
  });
});

describe("formatProfileMarkdown", () => {
  it("empty state message", () => {
    expect(formatProfileMarkdown([])).toMatch(/Tidak ada profil/);
  });
  it("emit tabel per scenario", () => {
    const p = createProfiler(true);
    p.wrap("f", () => 1)();
    const md = formatProfileMarkdown([p.finalize("scenA", "batched", 1)]);
    expect(md).toMatch(/scenA/);
    expect(md).toMatch(/\| Fungsi \|/);
    expect(md).toMatch(/\| f \|/);
  });
});
