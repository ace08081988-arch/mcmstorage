import { describe, expect, it } from "vitest";
import {
  buildPaymentMessageLines,
  LOCATION_MISSING_PLACEHOLDER,
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

/**
 * Urutan baris caption WA HARUS stabil walaupun baris lain (harga item,
 * catatan, sisa hutang, dsb) berubah. Kalau urutan pecah, pembeli membaca
 * angka dalam konteks yang salah dan pengirim tidak sadar 📍 kosong.
 *
 * Kontrak urutan (top → bottom):
 *   1. Judul (*bold*)
 *   2. Baris item / harga  (variabel)
 *   3. Total
 *   4. Baris pembayaran (Pembayaran / Dibayar / Sisa hutang)
 *   5. Catatan (opsional, variabel)
 *   6. Blok 📍 (URL asli atau placeholder)
 */
function composeFullCaption(opts: {
  title: string;
  itemLines?: string[];
  method: "kas" | "hutang" | "partial";
  total: number;
  paid?: number;
  notes?: string[];
  locationUrl?: string | null;
}): string {
  const p = getPaymentBreakdown(opts.method, opts.total, opts.paid ?? 0);
  const lines: string[] = [`*${opts.title}*`, ""];
  if (opts.itemLines?.length) lines.push(...opts.itemLines, "");
  lines.push(`Total: Rp${p.total.toLocaleString("id-ID")}`);
  lines.push(...buildPaymentMessageLines(p));
  if (opts.notes?.length) lines.push("", ...opts.notes);
  if (opts.locationUrl) {
    lines.push("", "📍 Lokasi ambil:", opts.locationUrl);
  } else {
    lines.push("📍 Lokasi belum diisi (owner akan menyusul link)");
  }
  return lines.join("\n");
}

function idxAll(cap: string, needles: string[]): number[] {
  return needles.map((n) => {
    const i = cap.indexOf(n);
    if (i < 0) throw new Error(`missing line: ${n}`);
    return i;
  });
}

function isStrictlyIncreasing(nums: number[]): boolean {
  return nums.every((n, i) => i === 0 || nums[i - 1] < n);
}

describe("caption WA — urutan baris tetap stabil di semua variasi", () => {
  it("Hutang: judul < Total < Pembayaran < Sisa hutang < 📍 (dengan URL)", () => {
    const cap = composeFullCaption({
      title: "Kacang 500g",
      itemLines: ["1× Kacang tanah — Rp25.000"],
      method: "hutang",
      total: 25_000,
      locationUrl: "https://maps.app.goo.gl/abc",
    });
    expect(
      isStrictlyIncreasing(
        idxAll(cap, [
          "*Kacang 500g*",
          "Total: Rp25.000",
          "Pembayaran: Hutang",
          "Sisa hutang: Rp25.000",
          "📍 Lokasi ambil:",
          "https://maps.app.goo.gl/abc",
        ]),
      ),
    ).toBe(true);
  });

  it("Partial: Dibayar mendahului Sisa hutang; keduanya sebelum 📍 (placeholder)", () => {
    const cap = composeFullCaption({
      title: "Gula 1kg",
      itemLines: ["1× Gula pasir — Rp15.000", "1× Kopi bubuk — Rp15.000"],
      method: "partial",
      total: 30_000,
      paid: 10_000,
      notes: ["Catatan: minta bungkus rangkap"],
    });
    expect(
      isStrictlyIncreasing(
        idxAll(cap, [
          "*Gula 1kg*",
          "1× Gula pasir",
          "Total: Rp30.000",
          "Pembayaran: Bayar sebagian",
          "Dibayar: Rp10.000",
          "Sisa hutang: Rp20.000",
          "Catatan: minta bungkus rangkap",
          "📍 Lokasi belum diisi (owner akan menyusul link)",
        ]),
      ),
    ).toBe(true);
  });

  it("Lunas: catatan tambahan tidak menggeser posisi 📍 di paling bawah", () => {
    const cap = composeFullCaption({
      title: "Beras 5kg",
      method: "kas",
      total: 60_000,
      notes: ["Catatan A", "Catatan B", "Catatan C"],
      locationUrl: "https://maps.google.com/?q=1,2",
    });
    const lines = cap.split("\n").filter((l) => l.length > 0);
    // 📍 URL harus dua baris terakhir (label + url) dengan label mendahului url.
    expect(lines[lines.length - 2]).toBe("📍 Lokasi ambil:");
    expect(lines[lines.length - 1]).toBe("https://maps.google.com/?q=1,2");
  });

  it("Placeholder 📍 selalu jadi baris terakhir walau ada banyak catatan", () => {
    const cap = composeFullCaption({
      title: "Item",
      method: "hutang",
      total: 5_000,
      notes: ["N1", "N2", "N3", "N4"],
      locationUrl: null,
    });
    const lines = cap.split("\n").filter((l) => l.length > 0);
    expect(lines[lines.length - 1]).toBe(
      "📍 Lokasi belum diisi (owner akan menyusul link)",
    );
  });

  it("Perubahan harga item TIDAK menggeser urutan relatif pembayaran ↔ 📍", () => {
    const priceVariants = [1_000, 25_000, 999_999, 12_345_678];
    for (const total of priceVariants) {
      const cap = composeFullCaption({
        title: "Var",
        itemLines: [`1× X — Rp${total.toLocaleString("id-ID")}`],
        method: "hutang",
        total,
        locationUrl: null,
      });
      expect(
        isStrictlyIncreasing(
          idxAll(cap, [
            `Total: Rp${total.toLocaleString("id-ID")}`,
            "Pembayaran: Hutang",
            `Sisa hutang: Rp${total.toLocaleString("id-ID")}`,
            "📍 Lokasi belum diisi (owner akan menyusul link)",
          ]),
        ),
      ).toBe(true);
    }
  });

  it("Placeholder tidak pernah muncul BERSAMAAN dengan 'Lokasi ambil:'", () => {
    const withUrl = composeFullCaption({
      title: "A",
      method: "partial",
      total: 10_000,
      paid: 3_000,
      locationUrl: "https://x.test",
    });
    const withoutUrl = composeFullCaption({
      title: "A",
      method: "partial",
      total: 10_000,
      paid: 3_000,
      locationUrl: null,
    });
    expect(withUrl.includes("Lokasi belum diisi")).toBe(false);
    expect(withUrl.includes("Lokasi ambil:")).toBe(true);
    expect(withoutUrl.includes("Lokasi belum diisi")).toBe(true);
    expect(withoutUrl.includes("Lokasi ambil:")).toBe(false);
  });
});
/**
 * SSOT: `buildPaymentMessageLines` sendiri (bukan hanya call-site) sekarang
 * bertanggung jawab menyisipkan blok 📍 kalau caller memberikan `locationUrl`.
 * Kontrak:
 *   - opsi tanpa key `locationUrl` → tidak ada baris lokasi (backward-compat).
 *   - `locationUrl: string non-kosong` → "📍 Lokasi ambil:" + URL, dipisahkan baris kosong.
 *   - `locationUrl: null | "" | "   "` → satu baris placeholder persis.
 * Berlaku identik untuk metode kas / hutang / partial.
 */
describe("buildPaymentMessageLines — opsi locationUrl (semua metode)", () => {
  const CASES = [
    { method: "kas" as const, total: 10_000, paid: 0, base: ["Pembayaran: Lunas"] },
    {
      method: "hutang" as const,
      total: 10_000,
      paid: 0,
      base: ["Pembayaran: Hutang", "Sisa hutang: Rp10.000"],
    },
    {
      method: "partial" as const,
      total: 10_000,
      paid: 2_500,
      base: ["Pembayaran: Bayar sebagian", "Dibayar: Rp2.500", "Sisa hutang: Rp7.500"],
    },
  ];

  it.each(CASES)("$method: tanpa opsi → tidak menambah blok lokasi", ({ method, total, paid, base }) => {
    const p = getPaymentBreakdown(method, total, paid);
    expect(buildPaymentMessageLines(p)).toEqual(base);
  });

  it.each(CASES)("$method: locationUrl string → append 📍 Lokasi ambil + URL", ({ method, total, paid, base }) => {
    const p = getPaymentBreakdown(method, total, paid);
    const url = "https://maps.app.goo.gl/xyz";
    expect(buildPaymentMessageLines(p, { locationUrl: url })).toEqual([
      ...base,
      "",
      "📍 Lokasi ambil:",
      url,
    ]);
  });

  it.each(CASES)("$method: locationUrl null → append placeholder tepat", ({ method, total, paid, base }) => {
    const p = getPaymentBreakdown(method, total, paid);
    expect(buildPaymentMessageLines(p, { locationUrl: null })).toEqual([
      ...base,
      LOCATION_MISSING_PLACEHOLDER,
    ]);
  });

  it.each(CASES)("$method: locationUrl '' → placeholder (bukan URL kosong)", ({ method, total, paid, base }) => {
    const p = getPaymentBreakdown(method, total, paid);
    expect(buildPaymentMessageLines(p, { locationUrl: "" })).toEqual([
      ...base,
      LOCATION_MISSING_PLACEHOLDER,
    ]);
  });

  it.each(CASES)("$method: locationUrl whitespace → placeholder (di-trim)", ({ method, total, paid, base }) => {
    const p = getPaymentBreakdown(method, total, paid);
    expect(buildPaymentMessageLines(p, { locationUrl: "   \n\t " })).toEqual([
      ...base,
      LOCATION_MISSING_PLACEHOLDER,
    ]);
  });

  it("Urutan: 📍 selalu SETELAH baris pembayaran (semua metode)", () => {
    for (const { method, total, paid } of CASES) {
      const p = getPaymentBreakdown(method, total, paid);
      const linesUrl = buildPaymentMessageLines(p, { locationUrl: "https://x.test" });
      const linesEmpty = buildPaymentMessageLines(p, { locationUrl: null });
      // Baris terakhir yang menyebut pembayaran ada di indeks base.length - 1.
      const iPayLast = linesUrl.findIndex((l) => l.startsWith("Pembayaran:"));
      expect(iPayLast).toBeGreaterThanOrEqual(0);
      expect(linesUrl.indexOf("📍 Lokasi ambil:")).toBeGreaterThan(iPayLast);
      expect(linesEmpty.indexOf(LOCATION_MISSING_PLACEHOLDER)).toBeGreaterThan(iPayLast);
    }
  });

  it("Placeholder dan URL tidak pernah muncul bersamaan", () => {
    const p = getPaymentBreakdown("hutang", 5_000, 0);
    const withUrl = buildPaymentMessageLines(p, { locationUrl: "https://x.test" });
    const withoutUrl = buildPaymentMessageLines(p, { locationUrl: null });
    expect(withUrl).not.toContain(LOCATION_MISSING_PLACEHOLDER);
    expect(withoutUrl).not.toContain("📍 Lokasi ambil:");
  });

  it("Placeholder literal tidak berubah (snapshot kunci)", () => {
    expect(LOCATION_MISSING_PLACEHOLDER).toBe("📍 Lokasi belum diisi (owner akan menyusul link)");
  });
});

/**
 * Whitespace-only locationUrl WAJIB dianggap kosong. Kalau tidak, kita akan
 * mengirim "📍 Lokasi ambil:\n   " ke pembeli — link mati yang menyesatkan.
 * Jadi kunci kontrak ini eksplisit untuk berbagai varian whitespace dan
 * SEMUA metode pembayaran yang relevan (kas / hutang / partial).
 */
describe("buildPaymentMessageLines — whitespace-only locationUrl = placeholder", () => {
  const METHODS = [
    { method: "kas" as const, total: 10_000, paid: 0, baseLastLine: "Pembayaran: Lunas" },
    { method: "hutang" as const, total: 10_000, paid: 0, baseLastLine: "Sisa hutang: Rp10.000" },
    { method: "partial" as const, total: 10_000, paid: 3_000, baseLastLine: "Sisa hutang: Rp7.000" },
  ];

  const WHITESPACE_VARIANTS: Array<{ label: string; value: string }> = [
    { label: "single space", value: " " },
    { label: "many spaces", value: "          " },
    { label: "tabs", value: "\t\t\t" },
    { label: "newlines", value: "\n\n" },
    { label: "CRLF", value: "\r\n\r\n" },
    { label: "mixed spaces+tabs+newlines", value: " \t \n \t " },
    { label: "non-breaking space (U+00A0)", value: "\u00A0\u00A0" },
    { label: "ideographic space (U+3000)", value: "\u3000" },
    { label: "zero-width space (U+200B)", value: "\u200B" },
    { label: "form feed + vertical tab", value: "\f\v" },
    { label: "leading+trailing whitespace around empty", value: "   \t\n   " },
  ];

  for (const { method, total, paid, baseLastLine } of METHODS) {
    describe(`method=${method}`, () => {
      it.each(WHITESPACE_VARIANTS)(
        `whitespace "$label" → placeholder muncul, TIDAK ada 'Lokasi ambil:'`,
        ({ value }) => {
          const p = getPaymentBreakdown(method, total, paid);
          const lines = buildPaymentMessageLines(p, { locationUrl: value });
          expect(lines).toContain(LOCATION_MISSING_PLACEHOLDER);
          expect(lines).not.toContain("📍 Lokasi ambil:");
          // Tidak boleh ada baris yang isinya hanya whitespace mentah.
          expect(lines.some((l) => l.length > 0 && l.trim().length === 0)).toBe(false);
          // Placeholder harus JADI baris terakhir.
          expect(lines[lines.length - 1]).toBe(LOCATION_MISSING_PLACEHOLDER);
          // Baris pembayaran terakhir tetap ada di posisi yang benar (tepat sebelum placeholder).
          expect(lines[lines.length - 2]).toBe(baseLastLine);
        },
      );
    });
  }

  it("URL valid dengan whitespace di sekitar → di-trim & dipakai sebagai link", () => {
    const p = getPaymentBreakdown("hutang", 5_000, 0);
    const lines = buildPaymentMessageLines(p, {
      locationUrl: "   https://maps.app.goo.gl/xyz   \n",
    });
    // Kontrol positif: whitespace di sekeliling URL valid TIDAK memicu placeholder.
    expect(lines).not.toContain(LOCATION_MISSING_PLACEHOLDER);
    expect(lines).toContain("📍 Lokasi ambil:");
    expect(lines).toContain("https://maps.app.goo.gl/xyz");
  });
});

/**
 * Snapshot test: mengunci urutan baris DAN pemisah baris (LF, `CHAR(10)`).
 * Kalau seseorang tanpa sengaja mengganti separator jadi CRLF, menambah
 * baris kosong, atau menukar posisi "Sisa hutang" vs blok lokasi, snapshot
 * ini akan gagal — sebelum caption yang salah sampai ke pembeli.
 *
 * Kunci: kita snapshot hasil `lines.join("\n")` (bukan array-nya). Nilai
 * harga divariasikan untuk memastikan STRUKTUR-nya yang dikunci, bukan
 * angka spesifik.
 */
describe("buildPaymentMessageLines — snapshot urutan & separator (CHAR(10))", () => {
  const cases: Array<{
    name: string;
    method: "kas" | "hutang" | "partial";
    total: number;
    paid: number;
    locationUrl?: string | null;
  }> = [
    { name: "kas — tanpa opsi lokasi", method: "kas", total: 12_500, paid: 12_500 },
    { name: "kas — lokasi valid", method: "kas", total: 999_000, paid: 999_000, locationUrl: "https://maps.app.goo.gl/aaa" },
    { name: "kas — lokasi kosong (null)", method: "kas", total: 1, paid: 1, locationUrl: null },
    { name: "kas — lokasi kosong (string kosong)", method: "kas", total: 50_000, paid: 50_000, locationUrl: "" },
    { name: "hutang — tanpa opsi lokasi", method: "hutang", total: 250_000, paid: 0 },
    { name: "hutang — lokasi valid", method: "hutang", total: 7_500_000, paid: 0, locationUrl: "https://maps.app.goo.gl/bbb" },
    { name: "hutang — lokasi kosong", method: "hutang", total: 42, paid: 0, locationUrl: "" },
    { name: "partial — tanpa opsi lokasi", method: "partial", total: 100_000, paid: 30_000 },
    { name: "partial — lokasi valid", method: "partial", total: 1_234_567, paid: 500_000, locationUrl: "https://maps.app.goo.gl/ccc" },
    { name: "partial — lokasi kosong", method: "partial", total: 88_888, paid: 8_888, locationUrl: null },
  ];

  it.each(cases)("$name", ({ method, total, paid, locationUrl }) => {
    const p = getPaymentBreakdown(method, total, paid);
    const lines =
      locationUrl === undefined
        ? buildPaymentMessageLines(p)
        : buildPaymentMessageLines(p, { locationUrl });
    const joined = lines.join("\n");

    // Separator kontrak: LF (CHAR(10)) — bukan CRLF, bukan CR.
    expect(joined).not.toMatch(/\r/);
    // Snapshot mengunci urutan + separator + literal placeholder.
    expect(joined).toMatchSnapshot();
  });

  it("join(\\n) round-trip: split(\\n) mengembalikan array baris asli", () => {
    const p = getPaymentBreakdown("partial", 100_000, 40_000);
    const lines = buildPaymentMessageLines(p, { locationUrl: "https://x.test/1" });
    expect(lines.join("\n").split("\n")).toEqual(lines);
  });

  it("Perubahan nilai harga TIDAK menggeser struktur baris (jumlah & posisi)", () => {
    const shape = (total: number, paid: number) =>
      buildPaymentMessageLines(getPaymentBreakdown("partial", total, paid), {
        locationUrl: "https://x.test/loc",
      }).map((l) => (l === "" ? "<EMPTY>" : l.replace(/Rp[\d.]+/g, "Rp<AMOUNT>")));
    // Dua nominal berbeda harus menghasilkan struktur baris IDENTIK.
    expect(shape(100_000, 25_000)).toEqual(shape(9_999_999, 1));
  });
});
