import { describe, it, expect } from "vitest";
import { parseWeightToGrams, formatGramsSmart, parsePlainQty } from "./weight-parse";

describe("parseWeightToGrams", () => {
  it("kg → gram", () => {
    expect(parseWeightToGrams("1 kg")).toBe(1000);
    expect(parseWeightToGrams("1kg")).toBe(1000);
    expect(parseWeightToGrams("2 KG")).toBe(2000);
    expect(parseWeightToGrams("0.5 kg")).toBe(500);
    expect(parseWeightToGrams("1,5 kg")).toBe(1500);
    expect(parseWeightToGrams("1.234,5 kg")).toBe(1_234_500);
  });
  it("gram bervariasi", () => {
    expect(parseWeightToGrams("500 gr")).toBe(500);
    expect(parseWeightToGrams("500g")).toBe(500);
    expect(parseWeightToGrams("500 gram")).toBe(500);
    expect(parseWeightToGrams("500 gr.")).toBe(500);
  });
  it("ons → gram (1 ons = 100 gr)", () => {
    expect(parseWeightToGrams("1 ons")).toBe(100);
    expect(parseWeightToGrams("2ons")).toBe(200);
    expect(parseWeightToGrams("0,5 ons")).toBe(50);
  });
  it("mg → gram (1000 mg = 1 gr)", () => {
    expect(parseWeightToGrams("1000 mg")).toBe(1);
    expect(parseWeightToGrams("500 mg")).toBe(0.5);
    expect(parseWeightToGrams("1 mg")).toBe(0.001);
  });
  it("angka tanpa satuan → gram", () => {
    expect(parseWeightToGrams("1000")).toBe(1000);
    expect(parseWeightToGrams("2,5")).toBe(2.5);
  });
  it("input tidak valid → null", () => {
    expect(parseWeightToGrams("")).toBeNull();
    expect(parseWeightToGrams(null)).toBeNull();
    expect(parseWeightToGrams(undefined)).toBeNull();
    expect(parseWeightToGrams("abc")).toBeNull();
    expect(parseWeightToGrams("1 xyz")).toBeNull();
    expect(parseWeightToGrams("-1 kg")).toBeNull();
  });
  it("angka numerik langsung", () => {
    expect(parseWeightToGrams(1000)).toBe(1000);
    expect(parseWeightToGrams(0)).toBe(0);
    expect(parseWeightToGrams(-5)).toBeNull();
  });
});

describe("formatGramsSmart", () => {
  it("format kg untuk ≥ 1000", () => {
    expect(formatGramsSmart(1000)).toBe("1 kg");
    expect(formatGramsSmart(1500)).toBe("1,5 kg");
    expect(formatGramsSmart(2500)).toBe("2,5 kg");
  });
  it("format gr default", () => {
    expect(formatGramsSmart(500)).toBe("500 gr");
    expect(formatGramsSmart(250)).toBe("250 gr");
  });
  it("preferOns aktif untuk kelipatan 100", () => {
    expect(formatGramsSmart(200, { preferOns: true })).toBe("2 ons");
    expect(formatGramsSmart(300, { preferOns: true })).toBe("3 ons");
    expect(formatGramsSmart(250, { preferOns: true })).toBe("250 gr");
  });
  it("format mg untuk < 1 gr", () => {
    expect(formatGramsSmart(0.5)).toBe("500 mg");
    expect(formatGramsSmart(0.001)).toBe("1 mg");
  });
  it("nol tetap gr", () => {
    expect(formatGramsSmart(0)).toBe("0 gr");
  });
});

describe("parsePlainQty", () => {
  it("angka biasa", () => {
    expect(parsePlainQty("10")).toBe(10);
    expect(parsePlainQty("2,5")).toBe(2.5);
    expect(parsePlainQty(3)).toBe(3);
  });
  it("invalid → null", () => {
    expect(parsePlainQty("")).toBeNull();
    expect(parsePlainQty("abc")).toBeNull();
    expect(parsePlainQty("-1")).toBeNull();
  });
});