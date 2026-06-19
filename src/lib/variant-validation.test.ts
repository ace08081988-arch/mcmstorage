import { describe, it, expect } from "vitest";
import { validateVariantWeight, validateVariantLabel } from "./variant-validation";

describe("validateVariantWeight", () => {
  it.each([
    [0.9, true],
    [0.01, true],
    [1, true],
    ["0.40", true],
    ["0.20", true],
  ])("accepts positive weight %j", (input, ok) => {
    expect(validateVariantWeight(input).ok).toBe(ok);
  });

  it.each([
    [0, "zero"],
    ["0", "string zero"],
    [-0.1, "negative number"],
    ["-1", "negative string"],
    [Number.NaN, "NaN"],
    [Number.POSITIVE_INFINITY, "Infinity"],
    ["", "empty string"],
    ["abc", "non-numeric"],
    [null, "null"],
    [undefined, "undefined"],
  ])("rejects %s (%s)", (input, _label) => {
    const r = validateVariantWeight(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Berat per unit/);
  });

  it("error message for zero/negative mentions nol/negatif", () => {
    const r = validateVariantWeight(0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nol atau negatif/);
  });
});

describe("validateVariantLabel", () => {
  it("accepts non-empty label", () => {
    expect(validateVariantLabel("1G").ok).toBe(true);
    expect(validateVariantLabel("  ST  ").ok).toBe(true);
  });
  it.each([["", "empty"], ["   ", "whitespace"], [null, "null"], [undefined, "undefined"], [123, "number"]])(
    "rejects %j (%s)",
    (input, _label) => {
      expect(validateVariantLabel(input).ok).toBe(false);
    },
  );
});