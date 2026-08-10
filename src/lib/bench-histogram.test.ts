import { describe, it, expect } from "vitest";
import {
  buildHistogram,
  formatHistogramBlock,
  formatHistogramMarkdown,
} from "./bench-histogram";

describe("bench-histogram", () => {
  it("empty samples → n=0 dan tidak ada bin", () => {
    const h = buildHistogram("s", "batched", []);
    expect(h.n).toBe(0);
    expect(h.bins).toEqual([]);
    expect(h.outliers).toEqual([]);
  });

  it("semua sample sama → single-bin, binWidth=0", () => {
    const h = buildHistogram("s", "batched", [1, 1, 1, 1, 1]);
    expect(h.bins).toHaveLength(1);
    expect(h.bins[0]!.count).toBe(5);
    expect(h.binWidth).toBe(0);
    expect(h.outliers).toEqual([]);
  });

  it("total count di bins == n dan outliers cuma sample > p95", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 100];
    const h = buildHistogram("s", "batched", samples);
    const total = h.bins.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(samples.length);
    expect(h.n).toBe(samples.length);
    expect(h.min).toBe(1);
    expect(h.max).toBe(100);
    // p95 dari 15 sample ~ interpolasi di antara nilai teratas; 100 jelas > p95.
    expect(h.outliers).toContain(100);
    for (const o of h.outliers) expect(o).toBeGreaterThan(h.p95);
  });

  it("bin count = max(5, ceil(sqrt(n)))", () => {
    const s10 = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(buildHistogram("a", "b", s10).bins.length).toBe(5); // ceil(sqrt(10))=4 → 5
    const s100 = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(buildHistogram("a", "b", s100).bins.length).toBe(10);
  });

  it("format markdown menyertakan penanda p50/p95 dan header scenario", () => {
    const samples = Array.from({ length: 20 }, (_, i) => i + 1);
    const h = buildHistogram("wide", "batched", samples);
    const md = formatHistogramBlock(h);
    expect(md).toContain("**wide** (batched)");
    expect(md).toMatch(/← p50/);
    expect(md).toMatch(/← p95/);
  });

  it("formatHistogramMarkdown mengembalikan placeholder saat kosong", () => {
    const md = formatHistogramMarkdown([]);
    expect(md).toContain("Distribusi sampel durasi");
    expect(md).toContain("Tidak ada scenario tercatat");
  });
});