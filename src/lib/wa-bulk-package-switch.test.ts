import { describe, it, expect } from "vitest";
import { buildWhatsAppUrl } from "@/lib/share-wa";
import {
  buildPesan,
  formatJumlah,
  type Produk,
  type Satuan,
} from "@/routes/_authenticated.index";

/**
 * Mengirim pesan WA untuk BEBERAPA item sekaligus (bulk share dari
 * `_authenticated.index.tsx` baris 573-577). Test ini memastikan tiap
 * item di dalam bulk mengikuti Jenis kemasan *terbaru* — tidak ada
 * item yang menyisakan satuan lama walaupun urutan/id-nya tetap sama,
 * dan URL akhir tetap aman di-decode ke string bulk yang identik.
 */

function rupiah(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);
}

/** Replika 1:1 dari `bulkPesan()` di halaman index. */
function buildBulkPesan(items: Produk[]): string {
  const total = items.reduce((s, i) => s + i.harga, 0);
  return (
    items.map((p, idx) => `${idx + 1}. ${buildPesan(p)}`).join("\n\n") +
    `\n\n💵 *Total: ${rupiah(total)}*`
  );
}

function makeProduk(id: number, satuan: Satuan, jumlah: number, over: Partial<Produk> = {}): Produk {
  return {
    id,
    kategori: "Sembako",
    nama: `Produk ${id}`,
    harga: 10_000 * id,
    status: "Belum Dikirim",
    keterangan: "-",
    lokasi: `Rak ${id}`,
    satuan,
    jumlah,
    ...over,
  };
}

function decodeBulkText(url: string): string {
  const u = new URL(url);
  const raw = u.searchParams.get("text");
  expect(raw).not.toBeNull();
  return raw!;
}

describe("Bulk WA — tiap item mengikuti Jenis kemasan terbaru", () => {
  it("bulk 4 item dengan satuan berbeda: setiap baris ⚖️ = satuan item-nya", () => {
    const items: Produk[] = [
      makeProduk(1, "gram", 500),
      makeProduk(2, "kg", 1.5),
      makeProduk(3, "botol", 3),
      makeProduk(4, "pcs", 12),
    ];

    const url = buildWhatsAppUrl(buildBulkPesan(items));
    const text = decodeBulkText(url);

    // Round-trip.
    expect(text).toBe(buildBulkPesan(items));

    // Nomor urut per item hadir.
    expect(text).toContain("1. ");
    expect(text).toContain("2. ");
    expect(text).toContain("3. ");
    expect(text).toContain("4. ");

    // Tiap item memakai satuan-nya sendiri (bukan tetangga).
    expect(text).toContain(`⚖️ ${formatJumlah(500, "gram")}`); // "500 g"
    expect(text).toContain(`⚖️ ${formatJumlah(1.5, "kg")}`); // "1,5 kg"
    expect(text).toContain(`⚖️ ${formatJumlah(3, "botol")}`);
    expect(text).toContain(`⚖️ ${formatJumlah(12, "pcs")}`);

    // Total di baris terakhir.
    const total = items.reduce((s, i) => s + i.harga, 0);
    expect(text).toContain(`💵 *Total: ${rupiah(total)}*`);
  });

  it("mengubah satuan salah satu item lalu bulk-share: hanya item itu yang berubah", () => {
    const initial: Produk[] = [
      makeProduk(1, "gram", 500),
      makeProduk(2, "botol", 2),
      makeProduk(3, "pcs", 4),
    ];
    const before = decodeBulkText(buildWhatsAppUrl(buildBulkPesan(initial)));

    // Ganti satuan item #2 dari "botol" → "sachet".
    const updated = initial.map((p) =>
      p.id === 2 ? { ...p, satuan: "sachet" as Satuan, jumlah: 10 } : p,
    );
    const after = decodeBulkText(buildWhatsAppUrl(buildBulkPesan(updated)));

    expect(after).not.toBe(before);
    // Item #2 memakai satuan baru.
    expect(after).toContain(`2. `);
    expect(after).toContain(`⚖️ ${formatJumlah(10, "sachet")}`);
    // TIDAK boleh ada lagi baris "⚖️ 2 botol" (sisa satuan lama item #2).
    expect(after).not.toContain(`⚖️ ${formatJumlah(2, "botol")}`);
    // Item #1 & #3 tetap.
    expect(after).toContain(`⚖️ ${formatJumlah(500, "gram")}`);
    expect(after).toContain(`⚖️ ${formatJumlah(4, "pcs")}`);
  });

  it("beralih satuan pada SEMUA item (gram→kg, botol→pcs, sachet→dus) tidak menyisakan literal lama", () => {
    const gen1: Produk[] = [
      makeProduk(1, "gram", 1000),
      makeProduk(2, "botol", 5),
      makeProduk(3, "sachet", 20),
    ];
    const gen2: Produk[] = [
      { ...gen1[0], satuan: "kg", jumlah: 1 },
      { ...gen1[1], satuan: "pcs", jumlah: 5 },
      { ...gen1[2], satuan: "dus", jumlah: 2 },
    ];

    const t1 = decodeBulkText(buildWhatsAppUrl(buildBulkPesan(gen1)));
    const t2 = decodeBulkText(buildWhatsAppUrl(buildBulkPesan(gen2)));

    expect(t1).not.toBe(t2);

    // t2 hanya berisi satuan baru pada baris ⚖️.
    const scale = t2.match(/⚖️ [^\n]+/g) ?? [];
    expect(scale).toHaveLength(3);
    expect(scale[0]).toBe(`⚖️ ${formatJumlah(1, "kg")}`);
    expect(scale[1]).toBe(`⚖️ ${formatJumlah(5, "pcs")}`);
    expect(scale[2]).toBe(`⚖️ ${formatJumlah(2, "dus")}`);

    // Tidak ada baris ⚖️ yang masih "gram/botol/sachet".
    for (const s of scale) {
      expect(s).not.toMatch(/\b(gram|botol|sachet)\b/);
      expect(s).not.toMatch(/\d\sg\b/); // "500 g" bocor dari gen1.
    }
  });

  it("urutan item tetap terjaga; menghapus 1 item me-renumber tanpa mencampur satuan", () => {
    const list: Produk[] = [
      makeProduk(10, "gram", 250),
      makeProduk(11, "kg", 2),
      makeProduk(12, "botol", 3),
      makeProduk(13, "pcs", 6),
    ];
    const dropMid = list.filter((p) => p.id !== 11);
    const t = decodeBulkText(buildWhatsAppUrl(buildBulkPesan(dropMid)));
    // Renumber 1..3.
    expect(t).toMatch(/^1\. /m);
    expect(t).toMatch(/^2\. /m);
    expect(t).toMatch(/^3\. /m);
    expect(t).not.toMatch(/^4\. /m);
    // Tidak boleh ada baris "2 kg" (item yang dihapus).
    expect(t).not.toContain(`⚖️ ${formatJumlah(2, "kg")}`);
    // Sisa item pakai satuannya masing-masing.
    expect(t).toContain(`⚖️ ${formatJumlah(250, "gram")}`);
    expect(t).toContain(`⚖️ ${formatJumlah(3, "botol")}`);
    expect(t).toContain(`⚖️ ${formatJumlah(6, "pcs")}`);
  });

  it("URL wa.me untuk bulk aman: encoded (tidak ada spasi/#/newline mentah) dan round-trip cocok", () => {
    const items: Produk[] = [
      makeProduk(1, "gram", 500, { nama: "Beras & Gula #1", keterangan: "line\nbreak" }),
      makeProduk(2, "kg", 0.75, { lokasi: "Rak A/2" }),
    ];
    const url = buildWhatsAppUrl(buildBulkPesan(items));
    const rawQuery = url.slice("https://wa.me/?text=".length);
    expect(rawQuery).not.toContain(" ");
    expect(rawQuery).not.toContain("\n");
    expect(rawQuery).not.toContain("#");
    expect(rawQuery.split("&").length).toBe(1);
    expect(decodeBulkText(url)).toBe(buildBulkPesan(items));
  });

  it("total bulk selalu mengikuti harga terbaru (independen dari satuan)", () => {
    const items: Produk[] = [
      makeProduk(1, "gram", 500),
      makeProduk(2, "botol", 3),
    ];
    const before = decodeBulkText(buildWhatsAppUrl(buildBulkPesan(items)));
    // Ganti hanya satuan (harga tetap) — total harus SAMA.
    const same = items.map((p) => ({ ...p, satuan: "pcs" as Satuan, jumlah: 1 }));
    const after = decodeBulkText(buildWhatsAppUrl(buildBulkPesan(same)));
    const total = items.reduce((s, i) => s + i.harga, 0);
    expect(before).toContain(`💵 *Total: ${rupiah(total)}*`);
    expect(after).toContain(`💵 *Total: ${rupiah(total)}*`);
  });
});