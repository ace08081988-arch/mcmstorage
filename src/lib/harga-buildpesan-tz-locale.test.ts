import { describe, it, expect } from "vitest";
import { buildPesan, formatJumlah, type Produk, type Satuan } from "@/routes/_authenticated.index";

/**
 * TZ × LOCALE MATRIX — memastikan formatting harga (`Intl.NumberFormat`
 * / `toLocaleString`) dan output `buildPesan()` TETAP konsisten meskipun
 * proses dijalankan dengan variabel lingkungan `TZ` dan `LC_ALL` yang
 * berbeda (mis. `Asia/Jakarta` vs `UTC`, `en-ID` vs `id-ID` vs `C.UTF-8`).
 *
 * Alasan penting: seluruh kode formatter memakai locale HARDCODED
 * `"id-ID"` — hasilnya wajib bit-exact di semua runtime (Node LTS,
 * current, Bun) dan tidak boleh geser saat CI mengubah `TZ`/`LC_ALL`.
 *
 * Test ini memanggil formatter langsung; matrix TZ/locale disuplai
 * lewat `.github/workflows/tz-locale-matrix.yml`.
 */

function rupiah(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);
}

function makeProduk(overrides: Partial<Produk> = {}): Produk {
  return {
    id: 42,
    kategori: "Sembako",
    nama: "Gula Aren",
    harga: 12_500,
    status: "Belum Dikirim",
    keterangan: "Stok terbatas",
    lokasi: "Rak A/3",
    satuan: "gram",
    jumlah: 1000,
    ...overrides,
  };
}

describe("Harga & buildPesan — TZ/locale invariance (id-ID locked)", () => {
  it("Intl.NumberFormat id-ID: pemisah ribuan pakai titik untuk currency IDR", () => {
    // Snapshot bit-exact untuk locale id-ID — TIDAK boleh berubah karena env.
    // Catatan: separator antara "Rp" dan digit adalah U+00A0 (NBSP) pada ICU
    // modern; kita cek dengan regex agar test tahan terhadap variasi
    // whitespace kecil yang tidak signifikan secara visual.
    const s15k = rupiah(15_000);
    expect(s15k).toMatch(/^Rp[\u00A0 ]15\.000$/);

    const s1M = rupiah(1_000_000);
    expect(s1M).toMatch(/^Rp[\u00A0 ]1\.000\.000$/);

    // Bilangan besar tetap memakai `.` sebagai pemisah ribuan (bukan `,`).
    expect(rupiah(1_234_567_890)).toMatch(/1\.234\.567\.890/);
    expect(rupiah(1_234_567_890)).not.toMatch(/,/);
  });

  it("Number.toLocaleString('id-ID') konsisten untuk pemisah ribuan", () => {
    expect((12_500).toLocaleString("id-ID")).toBe("12.500");
    expect((1_000).toLocaleString("id-ID")).toBe("1.000");
    expect((1_234_567).toLocaleString("id-ID")).toBe("1.234.567");
  });

  it("formatJumlah id-ID stabil untuk semua Satuan lintas TZ/locale", () => {
    // Angka besar → pastikan pemisah ribuan tetap `.`, bukan `,` (en-US).
    expect(formatJumlah(1000, "gram")).toBe("1.000 g");
    expect(formatJumlah(12_500, "gram")).toBe("12.500 g");
    expect(formatJumlah(1_000_000, "gram")).toBe("1.000.000 g");

    expect(formatJumlah(1.5, "kg")).toBe("1,5 kg");
    expect(formatJumlah(2, "botol")).toBe("2 botol");
    expect(formatJumlah(12, "sachet")).toBe("12 sachet");
    expect(formatJumlah(25, "pcs")).toBe("25 pcs");
  });

  it("buildPesan() bit-exact untuk baseline id-ID (tidak drift karena TZ/locale env)", () => {
    const p = makeProduk();
    const msg = buildPesan(p);

    // Baris harga wajib memakai pemisah ribuan `.` (id-ID), bukan `,` (en-*).
    expect(msg).toContain("💰 Harga: Rp 12.500");
    expect(msg).not.toMatch(/Rp 12,500/);

    // Baris jumlah untuk 1000 gram harus tetap "1.000 g" (id-ID).
    expect(msg).toContain("⚖️ 1.000 g");

    // Snapshot penuh (5 baris) untuk regresi total.
    expect(msg).toBe(
      [
        "📦 [Sem] *Gula Aren*",
        "⚖️ 1.000 g",
        "💰 Harga: Rp 12.500",
        "📍 Rak A/3",
        "Ket: Stok terbatas",
      ].join("\n"),
    );
  });

  it("Formatter tidak terpengaruh oleh Intl.DateTimeFormat().resolvedOptions().timeZone", () => {
    // Ambil TZ efektif dari runtime — hanya untuk log; hasil formatter harus
    // sama persis apapun nilainya (id-ID + IDR terkunci di kode).
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(typeof tz).toBe("string");

    // Ulangi assertion utama agar CI menampilkan pesan gagal yang jelas
    // ketika hanya sebagian nilai TZ yang break formatter.
    expect(rupiah(9_999_999)).toMatch(/^Rp[\u00A0 ]9\.999\.999$/);
    expect((9_999_999).toLocaleString("id-ID")).toBe("9.999.999");
  });

  it("buildPesan konsisten untuk semua Satuan (harga tetap id-ID)", () => {
    const SATUAN_ALL: Satuan[] = ["gram", "kg", "botol", "sachet", "pcs", "lusin", "pak", "dus"];
    for (const s of SATUAN_ALL) {
      const msg = buildPesan(makeProduk({ satuan: s, jumlah: s === "kg" ? 1.5 : 3 }));
      // Harga id-ID (`12.500`) tidak boleh pernah muncul dalam ejaan en-*
      // di baris manapun.
      expect(msg).toContain("Rp 12.500");
      expect(msg).not.toMatch(/Rp 12,500/);
    }
  });
});