import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor } from "../color-contrast";

describe("color-contrast", () => {
  it("hitam vs putih = 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("mendukung oklch", () => {
    const white = parseColor("oklch(1 0 0)");
    expect(white.r).toBeCloseTo(1, 2);
  });

  it("mendukung color-mix in oklab", () => {
    const mid = parseColor("color-mix(in oklab, #000000 50%, #ffffff)");
    expect(mid.r).toBeGreaterThan(0.3);
    expect(mid.r).toBeLessThan(0.8);
  });

  it("resolve var() dari peta token", () => {
    expect(contrastRatio("var(--fg)", "var(--bg)", { "--fg": "#000", "--bg": "#fff" })).toBeCloseTo(21, 1);
  });
});
