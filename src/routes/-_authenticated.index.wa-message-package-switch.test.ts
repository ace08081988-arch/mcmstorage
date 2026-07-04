import { describe, it, expect } from "vitest";
import { buildPesan, formatJumlah, type Produk, type Satuan } from "./_authenticated.index";

/**
 * Verifikasi: teks pesan WA yang dihasilkan `buildPesan` (Nama produk, jumlah,
 * harga, dan lokasi) selalu mengikuti pilihan Jenis kemasan (`satuan`) terbaru
 * setelah beralih gram ↔ botol/pcs/sachet. Tidak boleh menyisakan artefak
 * satuan sebelumnya di teks yang dikirim ke pelanggan.
 */

function makeProduk(overrides: Partial<Produk> = {}): Produk {
  return {
    id: 1,
    kategori: "Snack",
    nama: "Kopi Sachet Special",
    harga: 12500,
    status: "Belum Dikirim",
    keterangan: "-",
    lokasi: "https://maps.google.com/?q=-6.2,106.8",
    satuan: "pcs",
    jumlah: 3,
    ...overrides,
  };
}

// Semua label satuan yang mungkin muncul di teks (untuk cek anti-bocor).
const ALL_UNIT_LABELS: Record<Satuan, string> = {
  gram: " g",
  kg: " kg",
  botol: " botol",
  sachet: " sachet",
  pcs: " pcs",
  lusin: " lusin",
  pak: " pak",
  dus: " dus",
};

function expectOnlyUnit(text: string, expected: Satuan) {
  const wanted = ALL_UNIT_LABELS[expected];
  expect(text).toContain(wanted);
  for (const s of Object.keys(ALL_UNIT_LABELS) as Satuan[]) {
    if (s === expected) continue;
    // "kg" adalah substring dari "kg" saja; "g" bisa nyangkut di "gram" jadi
    // kita pakai label yang sudah punya spasi depan agar tidak false-positive.
    if (expected === "gram" && s === "kg") continue; // "kg" tidak akan muncul dari format gram
    expect(text).not.toContain(ALL_UNIT_LABELS[s]);
  }
}

describe("WA message (buildPesan) — Jenis kemasan switch", () => {
  it("selalu memuat Nama produk, harga, dan lokasi apa pun satuannya", () => {
    for (const s of ["gram", "kg", "botol", "sachet", "pcs"] as Satuan[]) {
      const text = buildPesan(makeProduk({ satuan: s, jumlah: s === "gram" ? 250 : 2 }));
      expect(text).toContain("*Kopi Sachet Special*");
      expect(text).toContain("Rp 12.500");
      expect(text).toContain("https://maps.google.com/?q=-6.2,106.8");
    }
  });

  it("gram → botol: teks tidak menyisakan ' g' dan memakai ' botol'", () => {
    const gramText = buildPesan(makeProduk({ satuan: "gram", jumlah: 250 }));
    expectOnlyUnit(gramText, "gram");
    const botolText = buildPesan(makeProduk({ satuan: "botol", jumlah: 3 }));
    expectOnlyUnit(botolText, "botol");
  });

  it("botol → gram: teks berubah dari 'botol' ke 'g' pada baris jumlah", () => {
    const botolText = buildPesan(makeProduk({ satuan: "botol", jumlah: 2 }));
    expect(botolText).toMatch(/⚖️ 2 botol/);
    const gramText = buildPesan(makeProduk({ satuan: "gram", jumlah: 500 }));
    expect(gramText).toMatch(/⚖️ 500 g/);
    expect(gramText).not.toContain(" botol");
  });

  it("gram → pcs → gram → sachet: setiap peralihan hanya menampilkan satuan terbaru", () => {
    const sequence: Satuan[] = ["gram", "pcs", "gram", "sachet", "gram", "botol"];
    let prevText = "";
    for (const s of sequence) {
      const t = buildPesan(makeProduk({ satuan: s, jumlah: s === "gram" ? 125 : 4 }));
      expectOnlyUnit(t, s);
      // Pastikan tidak identik dengan render sebelumnya (satuan pasti berbeda
      // di tiap langkah), membuktikan output benar-benar ikut input terbaru.
      expect(t).not.toBe(prevText);
      prevText = t;
    }
  });

  it("format angka jumlah mengikuti satuan: gram/kg fraksional, lainnya bulat", () => {
    expect(formatJumlah(1234.56, "gram")).toBe("1.234,56 g");
    expect(formatJumlah(1.234, "kg")).toBe("1,234 kg");
    expect(formatJumlah(5, "botol")).toBe("5 botol");
    expect(formatJumlah(5, "pcs")).toBe("5 pcs");
    expect(formatJumlah(5, "sachet")).toBe("5 sachet");
  });

  it("round-trip botol → gram → botol menghasilkan teks awal identik (tidak ada state bocor)", () => {
    const a = buildPesan(makeProduk({ satuan: "botol", jumlah: 2 }));
    const _mid = buildPesan(makeProduk({ satuan: "gram", jumlah: 999 }));
    const b = buildPesan(makeProduk({ satuan: "botol", jumlah: 2 }));
    expect(b).toBe(a);
  });
});