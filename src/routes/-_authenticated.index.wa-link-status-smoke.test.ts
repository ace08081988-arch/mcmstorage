import { describe, it, expect } from "vitest";
import { buildPesan, waHrefFor, type Produk, type Satuan } from "./_authenticated.index";

/**
 * Smoke test link "KIRIM WA" vs status kirim.
 *
 * Invarian yang dijaga:
 *   1. Status "Belum Dikirim" → link berisi `https://wa.me/?text=` dengan
 *      teks pesan yang PERSIS sama dengan `buildPesan` (round-trip decode).
 *   2. Status "Sudah Dikirim" → link WAJIB string kosong, supaya tombol WA
 *      tidak dirender dan pesanan tidak terkirim dua kali.
 */

function makeProduk(overrides: Partial<Produk> = {}): Produk {
  return {
    id: 1,
    kategori: "Snack",
    nama: "Kopi Sachet Special",
    harga: 12500,
    status: "Belum Dikirim",
    keterangan: "Titip di depan & bayar cash",
    lokasi: "https://maps.google.com/?q=-6.2,106.8",
    satuan: "pcs",
    jumlah: 3,
    ...overrides,
  };
}

function decodeText(url: string): string {
  const q = url.split("?text=")[1] ?? "";
  return decodeURIComponent(q);
}

describe("Smoke: link KIRIM WA mengikuti status kirim", () => {
  it('status "Belum Dikirim" → link berisi pesan lengkap (round-trip persis)', () => {
    const p = makeProduk();
    const url = waHrefFor(p);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeText(url)).toBe(buildPesan(p));
  });

  it('status "Belum Dikirim" → isi pesan memuat nama, jumlah, harga, dan lokasi', () => {
    const url = waHrefFor(makeProduk());
    const text = decodeText(url);
    expect(text).toContain("*Kopi Sachet Special*");
    expect(text).toContain("3 pcs");
    expect(text).toContain("Rp 12.500");
    expect(text).toContain("https://maps.google.com/?q=-6.2,106.8");
  });

  it("karakter spesial (&, =, #, newline, emoji) tidak memutus query string", () => {
    const p = makeProduk({
      nama: "Gula #1 & Kopi = Mantap 🔥",
      keterangan: "Baris1\nBaris2 & catatan?x=1#tag",
    });
    const url = waHrefFor(p);
    expect(url.split("?text=").length).toBe(2);
    expect(decodeText(url)).toBe(buildPesan(p));
  });

  it('status "Sudah Dikirim" → link kosong (tombol WA tidak dirender)', () => {
    const url = waHrefFor(makeProduk({ status: "Sudah Dikirim", sent_at: Date.now() }));
    expect(url).toBe("");
    expect(url).not.toContain("wa.me");
  });

  it("transisi Belum → Sudah → Belum: link hilang lalu muncul kembali utuh", () => {
    const base = makeProduk();
    const before = waHrefFor(base);
    const sent = waHrefFor({ ...base, status: "Sudah Dikirim", sent_at: Date.now() });
    const undone = waHrefFor({ ...base, status: "Belum Dikirim", sent_at: undefined });
    expect(before).not.toBe("");
    expect(sent).toBe("");
    expect(undone).toBe(before);
  });

  it("berlaku untuk semua satuan & data cacat (nama/lokasi kosong)", () => {
    const satuan: Satuan[] = ["gram", "kg", "botol", "sachet", "pcs", "lusin", "pak", "dus"];
    for (const s of satuan) {
      const p = makeProduk({ satuan: s, jumlah: s === "gram" ? 250 : 2 });
      expect(decodeText(waHrefFor(p))).toBe(buildPesan(p));
      expect(waHrefFor({ ...p, status: "Sudah Dikirim" })).toBe("");
    }
    const cacat = makeProduk({ nama: null as unknown as string, lokasi: null as unknown as string });
    expect(waHrefFor(cacat)).toContain("wa.me/?text=");
    expect(decodeText(waHrefFor(cacat))).not.toContain("null");
  });
});
