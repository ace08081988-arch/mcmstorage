import { describe, expect, it } from "vitest";
import {
  buildPaymentMessageLines,
  formatSoldPaymentSummary,
  getPaymentBreakdown,
  parsePaymentAmountInput,
} from "./payment-summary";

describe("payment-summary SSOT", () => {
  it("normalisasi angka input Rupiah konsisten", () => {
    expect(parsePaymentAmountInput("10.000")).toBe(10_000);
    expect(parsePaymentAmountInput("Rp 2.500")).toBe(2_500);
    expect(parsePaymentAmountInput("1500,50")).toBe(1500.5);
    expect(parsePaymentAmountInput("abc")).toBe(0);
  });

  it("Lunas: paid=total, sisa=0, tanpa baris Dibayar/Sisa", () => {
    const p = getPaymentBreakdown("kas", 10_000, 2_000);
    expect(p).toMatchObject({ label: "Lunas", paid: 10_000, remaining: 0, partialValid: true });
    expect(buildPaymentMessageLines(p)).toEqual(["Pembayaran: Lunas"]);
    expect(formatSoldPaymentSummary("kas", 10_000, 0)).toBe("Lunas · Rp10.000");
  });

  it("Hutang: paid=0, sisa=total, baris WA cantumkan sisa hutang", () => {
    const p = getPaymentBreakdown("hutang", 10_000, 2_000);
    expect(p).toMatchObject({ label: "Hutang", paid: 0, remaining: 10_000, partialValid: true });
    expect(buildPaymentMessageLines(p)).toEqual([
      "Pembayaran: Hutang",
      "Sisa hutang: Rp10.000",
    ]);
    expect(formatSoldPaymentSummary("hutang", 10_000, 0)).toBe("Piutang · Sisa Rp10.000");
  });

  it("Bayar sebagian: paid=input, sisa=total-paid, baris WA urut", () => {
    const p = getPaymentBreakdown("partial", 10_000, 2_500);
    expect(p).toMatchObject({ label: "Bayar sebagian", paid: 2_500, remaining: 7_500, partialValid: true });
    expect(buildPaymentMessageLines(p)).toEqual([
      "Pembayaran: Bayar sebagian",
      "Dibayar: Rp2.500",
      "Sisa hutang: Rp7.500",
    ]);
    expect(formatSoldPaymentSummary("partial", 10_000, 2_500)).toBe(
      "Bayar sebagian · Dibayar Rp2.500 · Sisa Rp7.500",
    );
  });

  it("Bayar sebagian invalid kalau 0 atau >= total", () => {
    expect(getPaymentBreakdown("partial", 10_000, 0).partialValid).toBe(false);
    expect(getPaymentBreakdown("partial", 10_000, 10_000).partialValid).toBe(false);
    expect(getPaymentBreakdown("partial", 10_000, 11_000).partialValid).toBe(false);
  });
});