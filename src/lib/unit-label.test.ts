import { describe, it, expect } from "vitest";
import { humanBaseUnit, isSameUnitLabel } from "./unit-label";

describe("isSameUnitLabel — sinonim satuan", () => {
  it("g / gram / gr / grams semuanya sama", () => {
    expect(isSameUnitLabel("g", "gram")).toBe(true);
    expect(isSameUnitLabel("gram", "gr")).toBe(true);
    expect(isSameUnitLabel("GRAMS", "g")).toBe(true);
    expect(isSameUnitLabel(" gram ", "g")).toBe(true);
  });

  it("kg / kilo / kilogram semuanya sama", () => {
    expect(isSameUnitLabel("kg", "kilogram")).toBe(true);
    expect(isSameUnitLabel("KILO", "kg")).toBe(true);
  });

  it("ons / hg dianggap sama", () => {
    expect(isSameUnitLabel("ons", "hg")).toBe(true);
  });

  it("satuan berbeda tidak sama", () => {
    expect(isSameUnitLabel("g", "kg")).toBe(false);
    expect(isSameUnitLabel("gram", "ons")).toBe(false);
    expect(isSameUnitLabel("pcs", "botol")).toBe(false);
    expect(isSameUnitLabel("g", "pcs")).toBe(false);
  });

  it("input kosong / null tidak match", () => {
    expect(isSameUnitLabel("", "g")).toBe(false);
    expect(isSameUnitLabel(null, "g")).toBe(false);
    expect(isSameUnitLabel(undefined, undefined)).toBe(false);
  });

  it("botol / karton bukan sinonim gram", () => {
    expect(isSameUnitLabel("botol", "g")).toBe(false);
    expect(isSameUnitLabel("karton", "botol")).toBe(false);
  });
});

describe("humanBaseUnit tetap konsisten", () => {
  it("botol per-pcs → 'botol'", () => {
    expect(humanBaseUnit("botol", "pcs")).toBe("botol");
  });
  it("gram base_unit dikembalikan apa adanya", () => {
    expect(humanBaseUnit("gram", "g")).toBe("g");
  });
});