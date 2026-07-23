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

/**
 * Regresi guard: baris "Sisa hutang" WAJIB muncul di pesan WA untuk metode
 * Hutang dan Bayar sebagian, dan link 📍 lokasi WAJIB ikut di baris terakhir
 * kalau `location_url` terisi. Kalau salah satu asumsi ini pecah, pembeli
 * kehilangan info kritikal (nominal hutang / titik ambil), jadi test ini
 * sengaja ketat.
 */
function composeCaption(opts: {
  title: string;
  method: "kas" | "hutang" | "partial";
  total: number;
  paid?: number;
  locationUrl?: string | null;
}): string {
  const p = getPaymentBreakdown(opts.method, opts.total, opts.paid ?? 0);
  const lines: string[] = [`*${opts.title}*`, "", `Total: Rp${p.total.toLocaleString("id-ID")}`];
  lines.push(...buildPaymentMessageLines(p));
  if (opts.locationUrl) {
    lines.push("", "📍 Lokasi ambil:", opts.locationUrl);
  } else {
    // Placeholder eksplisit — cermin logika di route Ecer/Request/ReadyPackagesPanel.
    lines.push("📍 Lokasi belum diisi (owner akan menyusul link)");
  }
  return lines.join("\n");
}

describe("caption WA regression — Sisa hutang & 📍 wajib muncul", () => {
  const AMOUNTS: Array<[number, number]> = [
    [1_000, 500],
    [10_000, 2_500],
    [123_456, 45_678],
    [999_999, 1],
    [50_000_000, 12_345_678],
  ];

  it.each(AMOUNTS)("Hutang total=%s → 'Sisa hutang: Rp<total>' muncul", (total) => {
    const lines = buildPaymentMessageLines(getPaymentBreakdown("hutang", total, 0));
    expect(lines[0]).toBe("Pembayaran: Hutang");
    expect(lines).toContain(`Sisa hutang: Rp${total.toLocaleString("id-ID")}`);
    expect(lines.some((l) => l.startsWith("Sisa hutang:"))).toBe(true);
  });

  it.each(AMOUNTS)("Bayar sebagian total=%s paid=%s → 'Dibayar' + 'Sisa hutang' terurut", (total, paid) => {
    const lines = buildPaymentMessageLines(getPaymentBreakdown("partial", total, paid));
    const iBayar = lines.findIndex((l) => l.startsWith("Dibayar:"));
    const iSisa = lines.findIndex((l) => l.startsWith("Sisa hutang:"));
    expect(iBayar).toBeGreaterThan(-1);
    expect(iSisa).toBeGreaterThan(iBayar);
    expect(lines).toContain(`Dibayar: Rp${paid.toLocaleString("id-ID")}`);
    expect(lines).toContain(`Sisa hutang: Rp${(total - paid).toLocaleString("id-ID")}`);
  });

  it("Lunas TIDAK boleh mencantumkan 'Sisa hutang' (menghindari pesan menyesatkan)", () => {
    const lines = buildPaymentMessageLines(getPaymentBreakdown("kas", 10_000, 0));
    expect(lines.some((l) => l.includes("Sisa hutang"))).toBe(false);
  });

  it("Caption Hutang menyertakan 'Sisa hutang' + baris 📍 lokasi", () => {
    const cap = composeCaption({
      title: "Kacang tanah 500g",
      method: "hutang",
      total: 25_000,
      locationUrl: "https://maps.google.com/?q=-6.2,106.8",
    });
    expect(cap).toContain("Pembayaran: Hutang");
    expect(cap).toContain("Sisa hutang: Rp25.000");
    expect(cap).toContain("📍 Lokasi ambil:");
    expect(cap).toContain("https://maps.google.com/?q=-6.2,106.8");
    // 📍 harus setelah baris pembayaran, bukan di atasnya.
    expect(cap.indexOf("📍")).toBeGreaterThan(cap.indexOf("Sisa hutang:"));
  });

  it("Caption Bayar sebagian menyertakan Dibayar + Sisa hutang + 📍", () => {
    const cap = composeCaption({
      title: "Gula 1kg",
      method: "partial",
      total: 30_000,
      paid: 10_000,
      locationUrl: "https://maps.app.goo.gl/xyz",
    });
    expect(cap).toContain("Dibayar: Rp10.000");
    expect(cap).toContain("Sisa hutang: Rp20.000");
    expect(cap).toMatch(/📍 Lokasi ambil:\nhttps:\/\/maps\.app\.goo\.gl\/xyz/);
  });

  it("Tanpa location_url: caption tidak memuat blok 📍 (tidak ada baris kosong palsu)", () => {
    const cap = composeCaption({ title: "X", method: "hutang", total: 5_000 });
    // Placeholder WAJIB muncul — bukan blok "Lokasi ambil:" + URL,
    // tapi satu baris peringatan supaya pengirim sadar 📍 belum lengkap.
    expect(cap).toContain("📍 Lokasi belum diisi (owner akan menyusul link)");
    expect(cap).not.toContain("Lokasi ambil:");
    expect(cap).toContain("Sisa hutang: Rp5.000");
  });
});

/**
 * Placeholder 📍 saat location_url kosong WAJIB muncul dengan format identik
 * di semua metode pembayaran yang relevan (Lunas/Hutang/Bayar sebagian).
 * Kalau format ini bergeser, pengirim tidak sadar lokasi kosong dan pembeli
 * kehilangan titik ambil — jadi kunci teks persisnya di sini.
 */
const LOCATION_PLACEHOLDER = "📍 Lokasi belum diisi (owner akan menyusul link)";

describe("caption WA — placeholder 📍 saat location_url kosong", () => {
  const METHODS: Array<{ method: "kas" | "hutang" | "partial"; paid?: number }> = [
    { method: "kas" },
    { method: "hutang" },
    { method: "partial", paid: 4_000 },
  ];

  it.each(METHODS)("method=$method tanpa lokasi → placeholder muncul persis", ({ method, paid }) => {
    const cap = composeCaption({ title: "Barang", method, total: 10_000, paid, locationUrl: null });
    expect(cap).toContain(LOCATION_PLACEHOLDER);
    expect(cap).not.toContain("Lokasi ambil:");
  });

  it.each(METHODS)("method=$method dengan lokasi → placeholder TIDAK muncul, URL ikut", ({ method, paid }) => {
    const url = "https://maps.app.goo.gl/abc";
    const cap = composeCaption({ title: "Barang", method, total: 10_000, paid, locationUrl: url });
    expect(cap).not.toContain(LOCATION_PLACEHOLDER);
    expect(cap).toContain("📍 Lokasi ambil:");
    expect(cap).toContain(url);
  });

  it("placeholder muncul SETELAH baris pembayaran (bukan sebelum)", () => {
    const cap = composeCaption({ title: "X", method: "hutang", total: 5_000, locationUrl: null });
    expect(cap.indexOf(LOCATION_PLACEHOLDER)).toBeGreaterThan(cap.indexOf("Sisa hutang:"));
  });

  it("format placeholder identik dengan yang dipakai route Ecer/Request/ReadyPackagesPanel", () => {
    // Snapshot literal — kalau berubah, semua call-site harus ikut diubah.
    expect(LOCATION_PLACEHOLDER).toBe("📍 Lokasi belum diisi (owner akan menyusul link)");
  });
});