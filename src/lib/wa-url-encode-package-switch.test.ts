import { describe, it, expect } from "vitest";
import { buildWhatsAppUrl, buildWhatsAppBusinessIntentUrl } from "@/lib/share-wa";
import { buildPesan, formatJumlah, type Produk, type Satuan } from "@/routes/_authenticated.index";

/**
 * Memastikan URL WhatsApp (wa.me & intent:// WA Business) yang dihasilkan
 * dari `buildPesan` terenkode dengan BENAR untuk setiap Jenis kemasan
 * (Satuan) dan tidak menahan potongan pesan lama saat Satuan berganti.
 *
 * Fokus utama: karakter khusus (spasi, koma id-ID, emoji, `*`, newline,
 * `#`, `&`) harus di-percent-encode sehingga saat di-decode menghasilkan
 * pesan yang identik dengan `buildPesan(p)`.
 */

const SATUAN_ALL: Satuan[] = ["gram", "kg", "botol", "sachet", "pcs", "lusin", "pak", "dus"];

function makeProduk(overrides: Partial<Produk> = {}): Produk {
  return {
    id: 1,
    kategori: "Sembako",
    nama: "Gula Merah #1 & Aren",
    harga: 12500,
    status: "Belum Dikirim",
    keterangan: "Stok terbatas + promo",
    lokasi: "Rak A/3",
    satuan: "gram",
    jumlah: 1000,
    ...overrides,
  };
}

/** Ambil nilai text dari URL wa.me (`?text=`) yang sudah di-decode. */
function decodeWaText(url: string): string {
  const u = new URL(url);
  const raw = u.searchParams.get("text");
  expect(raw).not.toBeNull();
  return raw!;
}

/** Ambil text dari intent:// URL (WA Business). */
function decodeIntentText(url: string): string {
  // Bentuknya: intent://send?[phone=X&]text=<encoded>#Intent;...
  const m = url.match(/intent:\/\/send\?(?:phone=\d+&)?text=([^#]+)#Intent/);
  expect(m, `intent url malformed: ${url}`).not.toBeNull();
  return decodeURIComponent(m![1]);
}

describe("wa.me URL encoding — konsistensi antar Satuan", () => {
  for (const s of SATUAN_ALL) {
    it(`buildWhatsAppUrl(buildPesan) round-trip untuk satuan=${s}`, () => {
      const p = makeProduk({ satuan: s, jumlah: s === "kg" ? 1.5 : 1000 });
      const pesan = buildPesan(p);
      const url = buildWhatsAppUrl(pesan);

      // Skema stabil.
      expect(url.startsWith("https://wa.me/?text=")).toBe(true);

      // Round-trip: decode(text) === buildPesan
      expect(decodeWaText(url)).toBe(pesan);

      // Satuan terbaru muncul dalam decoded text (bukan sisa satuan lama).
      expect(decodeWaText(url)).toContain(formatJumlah(p.jumlah!, s));
    });
  }

  it("karakter khusus (spasi, emoji, *, newline, #, &, /) ter-encode aman", () => {
    const p = makeProduk({
      nama: "Beras & Gula #1",
      keterangan: "line1\nline2 with *bold* and 100% pure",
      lokasi: "Rak A/3 (dekat pintu)",
    });
    const url = buildWhatsAppUrl(buildPesan(p));

    // Tidak boleh ada karakter yang memecah query string.
    // '#' menandai fragment, '&' memisah param — jika tidak di-encode,
    // query kedua akan hilang atau muncul sebagai fragment.
    const rawTextPart = url.slice("https://wa.me/?text=".length);
    expect(rawTextPart).not.toContain(" ");
    expect(rawTextPart).not.toContain("\n");
    expect(rawTextPart).not.toContain("#");
    // '&' tidak boleh muncul mentah sebelum di-decode.
    expect(rawTextPart.split("&").length).toBe(1);

    // Namun setelah decode, semua karakter khusus kembali persis.
    expect(decodeWaText(url)).toBe(buildPesan(p));
  });

  it("beralih Satuan tidak menyisakan potongan satuan lama pada URL berikutnya", () => {
    const p1 = makeProduk({ satuan: "gram", jumlah: 500 });
    const p2 = makeProduk({ ...p1, satuan: "kg", jumlah: 0.5 });
    const p3 = makeProduk({ ...p2, satuan: "botol", jumlah: 3 });
    const p4 = makeProduk({ ...p3, satuan: "pcs", jumlah: 12 });

    const url1 = buildWhatsAppUrl(buildPesan(p1));
    const url2 = buildWhatsAppUrl(buildPesan(p2));
    const url3 = buildWhatsAppUrl(buildPesan(p3));
    const url4 = buildWhatsAppUrl(buildPesan(p4));

    const t2 = decodeWaText(url2);
    const t3 = decodeWaText(url3);
    const t4 = decodeWaText(url4);

    // Tiap tahap mengandung satuan terbaru dan TIDAK memuat literal
    // satuan lawan pada baris ⚖️.
    expect(t2).toMatch(/⚖️ 0,5 kg/);
    expect(t2).not.toMatch(/⚖️ .* g\b/);
    expect(t3).toMatch(/⚖️ 3 botol/);
    expect(t3).not.toMatch(/⚖️ .* kg\b/);
    expect(t4).toMatch(/⚖️ 12 pcs/);
    expect(t4).not.toMatch(/⚖️ .* botol\b/);

    // Tidak ada satu URL pun yang identik (memastikan tidak ada
    // cache/reference dari langkah sebelumnya).
    expect(new Set([url1, url2, url3, url4]).size).toBe(4);
  });

  it("nomor telepon di-normalisasi (hanya digit) dan text tetap konsisten", () => {
    const pesan = buildPesan(makeProduk({ satuan: "kg", jumlah: 2.5 }));
    const url = buildWhatsAppUrl(pesan, "+62 812-3456-7890");
    expect(url.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
    expect(decodeWaText(url)).toBe(pesan);
  });

  it("angka id-ID (koma desimal & titik ribuan) tetap benar setelah round-trip", () => {
    const p = makeProduk({ satuan: "gram", jumlah: 1234.56, harga: 1_250_000 });
    const t = decodeWaText(buildWhatsAppUrl(buildPesan(p)));
    expect(t).toContain("1.234,56 g");
    expect(t).toContain("Rp 1.250.000");
  });
});

describe("intent:// (WA Business) — encoding & fallback", () => {
  for (const s of SATUAN_ALL) {
    it(`intent URL round-trip untuk satuan=${s}`, () => {
      const p = makeProduk({ satuan: s, jumlah: s === "kg" ? 2 : 750 });
      const pesan = buildPesan(p);
      const url = buildWhatsAppBusinessIntentUrl(pesan, "+62 812 0000 1111");

      expect(url.startsWith("intent://send?phone=6281200001111&text=")).toBe(true);
      expect(url).toContain("package=com.whatsapp.w4b");
      expect(url).toContain("scheme=whatsapp");

      // text= section decodes back to buildPesan.
      expect(decodeIntentText(url)).toBe(pesan);

      // browser_fallback_url harus juga mengarah ke wa.me dengan text sama.
      const fbMatch = url.match(/S\.browser_fallback_url=([^;]+);/);
      expect(fbMatch).not.toBeNull();
      const fallback = decodeURIComponent(fbMatch![1]);
      expect(fallback.startsWith("https://wa.me/6281200001111?text=")).toBe(true);
      expect(decodeWaText(fallback)).toBe(pesan);
    });
  }

  it("tanpa nomor telepon: intent URL menghilangkan segment phone=", () => {
    const url = buildWhatsAppBusinessIntentUrl("Halo *dunia*\nbaris 2");
    expect(url.startsWith("intent://send?text=")).toBe(true);
    expect(url).not.toContain("phone=");
    expect(decodeIntentText(url)).toBe("Halo *dunia*\nbaris 2");
  });
});