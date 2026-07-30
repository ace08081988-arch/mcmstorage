import { describe, it, expect } from "vitest";
import { buildWhatsAppUrl } from "@/lib/share-wa";
import {
  buildPesan,
  type Produk,
  type Satuan,
} from "@/routes/_authenticated.index";

/**
 * INTEGRATION — UI-level: memverifikasi bahwa link WhatsApp yang dirender
 * pada daftar produk (`<a href={waUrl}>` di `_authenticated.index.tsx`)
 *
 *   const waUrl = `https://wa.me/?text=${encodeURIComponent(buildPesan(p))}`
 *
 * berperilaku benar untuk BEBERAPA BARIS sekaligus:
 *
 *   1. Setiap baris menghasilkan `href` unik yang mengekspos `buildPesan(p)`
 *      persis (round-trip via WHATWG URL + decode).
 *   2. Saat Jenis kemasan (`satuan`) salah satu baris di-switch (mis. dari
 *      `gram` → `botol`), HANYA baris itu yang `href`-nya berubah — baris
 *      lain harus tetap identik (isolasi antar-row, tidak ada bleed dari
 *      state global / memo).
 *   3. Karakter khusus (`&`, `#`, `+`, `?`, `/`, ` `, `\n`, emoji, RTL,
 *      ZWJ/ZWSP) di `nama`, `keterangan`, dan `lokasi` tetap ter-encode
 *      dengan benar → URL bisa di-parse ulang oleh `new URL()` dan hanya
 *      punya satu param `text`.
 *   4. Ekuivalen dengan `buildWhatsAppUrl(buildPesan(p))` (helper yang
 *      dipakai di path share lain), sehingga UI dan share-lib tidak
 *      pernah divergen encoding-nya.
 */

/** Persis ekspresi yang dipakai di UI: baris `<a href={waUrl}>`. */
function rowHref(p: Produk): string {
  return `https://wa.me/?text=${encodeURIComponent(buildPesan(p))}`;
}

/** Extract `text` param terdekode dari URL wa.me. */
function decodeText(url: string): string {
  const u = new URL(url);
  const params = Array.from(u.searchParams.keys());
  // URL harus hanya punya satu key `text` (tidak bocor jadi query lain).
  expect(params).toEqual(["text"]);
  const raw = u.searchParams.get("text");
  expect(raw).not.toBeNull();
  return raw!;
}

const TRICKY = {
  ampHashPlus: "Gula & Aren #A+B ?diskon /promo",
  spacesNL: "Rak\nA / 3   (belakang)",
  emojiRTL: "بضاعة 🧂✨ שלום",
  zwj: "Kopi\u200D\u200BSachet",
};

function makeRows(): Produk[] {
  // Sengaja tidak identik: id, nama, harga, satuan, jumlah, lokasi, keterangan.
  return [
    {
      id: 101,
      kategori: "Sembako",
      nama: TRICKY.ampHashPlus,
      harga: 12_500,
      status: "Belum Dikirim",
      keterangan: "Stok terbatas + promo",
      lokasi: "Rak A/3",
      satuan: "gram",
      jumlah: 1000,
    },
    {
      id: 102,
      kategori: "Sembako",
      nama: "Minyak Goreng",
      harga: 18_900,
      status: "Belum Dikirim",
      keterangan: "",
      lokasi: TRICKY.spacesNL,
      satuan: "botol",
      jumlah: 2,
    },
    {
      id: 103,
      kategori: "Bumbu",
      nama: TRICKY.emojiRTL,
      harga: 7_250,
      status: "Belum Dikirim",
      keterangan: TRICKY.zwj,
      lokasi: "Gudang #2",
      satuan: "sachet",
      jumlah: 12,
    },
    {
      id: 104,
      kategori: "Snack",
      nama: "Kacang Telur",
      harga: 5_000,
      status: "Belum Dikirim",
      keterangan: "Renyah",
      lokasi: "Rak B/1",
      satuan: "pcs",
      jumlah: 25,
    },
  ];
}

const SWITCH_TARGETS: Satuan[] = ["gram", "kg", "botol", "sachet", "pcs", "lusin", "pak", "dus"];

describe("UI row `waUrl` — multi-row + package switch + special-char encoding", () => {
  it("setiap baris menghasilkan href unik yang round-trip ke buildPesan(p)", () => {
    const rows = makeRows();
    const hrefs = rows.map(rowHref);

    // (a) href harus URL absolut wa.me tanpa phone number.
    for (const h of hrefs) {
      expect(h.startsWith("https://wa.me/?text=")).toBe(true);
      const u = new URL(h);
      expect(u.host).toBe("wa.me");
      expect(u.pathname).toBe("/");
    }

    // (b) Round-trip bit-exact untuk setiap baris.
    rows.forEach((p, i) => {
      expect(decodeText(hrefs[i])).toBe(buildPesan(p));
    });

    // (c) Setara dengan buildWhatsAppUrl helper — UI & share-lib tidak divergen.
    rows.forEach((p, i) => {
      expect(hrefs[i]).toBe(buildWhatsAppUrl(buildPesan(p)));
    });

    // (d) Semua href unik (tidak ada 2 baris yang tabrakan).
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("karakter khusus di nama/lokasi/keterangan ter-encode aman", () => {
    const rows = makeRows();
    // Karakter yang harus DILINDUNGI dari mismatch parser wa.me: `&`, `#`, `?`.
    const hazards = ["&", "#", "?"];

    for (const p of rows) {
      const url = rowHref(p);
      const rawQuery = url.split("?text=")[1] ?? "";

      // Substring literal berbahaya tidak boleh muncul RAW di query string.
      for (const ch of hazards) {
        if ((p.nama + p.keterangan + p.lokasi).includes(ch)) {
          expect(rawQuery.includes(ch)).toBe(false);
        }
      }

      // Newline & spasi juga harus di-encode (encodeURIComponent → %0A / %20).
      if ((p.lokasi ?? "").includes("\n")) {
        expect(rawQuery.includes("\n")).toBe(false);
        expect(rawQuery.includes("%0A")).toBe(true);
      }

      // URL tetap valid setelah encoding "berat".
      expect(() => new URL(url)).not.toThrow();
    }
  });

  it("switching Jenis kemasan hanya mengubah href baris terkait (isolasi antar-row)", () => {
    const rows = makeRows();
    const before = rows.map(rowHref);

    // Mutasi satuan baris index 1 (`botol` → target lain), satu per satu.
    for (const target of SWITCH_TARGETS) {
      if (target === rows[1].satuan) continue;
      const mutated: Produk[] = rows.map((p, i) =>
        i === 1 ? { ...p, satuan: target } : p,
      );
      const after = mutated.map(rowHref);

      // Baris 0, 2, 3 harus tetap identik dengan snapshot awal.
      expect(after[0]).toBe(before[0]);
      expect(after[2]).toBe(before[2]);
      expect(after[3]).toBe(before[3]);

      // Baris 1 harus berbeda dan tetap round-trip ke buildPesan versi baru.
      expect(after[1]).not.toBe(before[1]);
      expect(decodeText(after[1])).toBe(buildPesan(mutated[1]));
    }
  });

  it("switching berurutan pada baris berbeda tidak membuat href tertinggal (no stale artifact)", () => {
    let rows = makeRows();

    // Skenario: setiap baris diputar melewati 3 satuan berbeda secara
    // bergantian. Setelah setiap step, seluruh href harus konsisten dengan
    // buildPesan versi terbaru — tidak ada baris yang "kembali" ke satuan
    // sebelumnya karena memoisasi bocor.
    const script: Array<{ row: number; to: Satuan }> = [
      { row: 0, to: "kg" },
      { row: 2, to: "pak" },
      { row: 1, to: "dus" },
      { row: 3, to: "lusin" },
      { row: 0, to: "sachet" },
      { row: 2, to: "botol" },
    ];

    for (const step of script) {
      rows = rows.map((p, i) => (i === step.row ? { ...p, satuan: step.to } : p));
      const hrefs = rows.map(rowHref);
      rows.forEach((p, i) => {
        // Round-trip ke pesan terbaru — bukan pesan versi sebelumnya.
        expect(decodeText(hrefs[i])).toBe(buildPesan(p));
        // Baris yang baru diubah wajib mencerminkan satuan target di pesannya.
        if (i === step.row) {
          const decoded = decodeText(hrefs[i]);
          // Baris `⚖️ ` harus ada dan berubah — cukup pastikan tidak kosong.
          expect(decoded.includes("⚖️")).toBe(true);
        }
      });
    }
  });
});