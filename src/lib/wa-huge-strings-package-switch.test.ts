import { describe, it, expect } from "vitest";
import { buildWhatsAppUrl } from "@/lib/share-wa";
import {
  buildPesan,
  formatJumlah,
  type Produk,
  type Satuan,
} from "@/routes/_authenticated.index";

/**
 * EDGE CASE — nama produk & lokasi berukuran SANGAT BESAR (mulai dari
 * ribuan sampai puluhan-ribu karakter, campuran ASCII + emoji astral +
 * ZWJ + RTL) harus:
 *   1. Tidak merusak struktur 5-baris `buildPesan()`.
 *   2. Menghasilkan URL `wa.me` yang tetap valid (parseable oleh WHATWG URL)
 *      dengan tepat satu query param `text`, tanpa spasi/newline/'#' mentah.
 *   3. Round-trip bit-exact: `decode(url) === buildPesan(p)`.
 *   4. Tetap konsisten setelah *switch satuan* — baris ⚖️ mengikuti satuan
 *      terbaru, sedangkan baris nama/lokasi/harga/ket tidak ikut berubah.
 */

const ALL_SATUAN: Satuan[] = [
  "gram", "kg", "botol", "sachet", "pcs", "lusin", "pak", "dus",
];

// Ukuran nama & lokasi dalam JUMLAH KARAKTER (bukan code units). Kombinasi
// besar-kecil untuk cover: sub-1K, ~4K, ~16K, ~64K.
const HUGE_SIZES = [1_000, 4_000, 16_000, 64_000];

// Pola berulang yang mencampur ASCII, emoji astral, ZWJ, RTL, CJK dan
// karakter unsafe untuk URL (spasi, '&', '#', '?', '=', '%', '\n').
const REPEAT_UNIT =
  "Beras “Super” 🌾👨‍🌾 أرز 米 & #1 ?q=v %20\n\tX";

function buildHuge(size: number): string {
  // Bangun string >= `size` karakter, lalu potong tepat di `size` code units.
  // Menerima potongan surrogate agar test benar-benar menekan buildPesan +
  // encodeURIComponent pada boundary yang "canggung".
  let s = "";
  while (s.length < size) s += REPEAT_UNIT;
  return s.slice(0, size);
}

function makeProduk(
  nama: string,
  lokasi: string,
  satuan: Satuan,
  jumlah: number,
): Produk {
  return {
    id: 1,
    kategori: "Sembako",
    nama,
    harga: 99_999,
    status: "Belum Dikirim",
    keterangan: "Ket panjang " + "abc ".repeat(200),
    lokasi,
    satuan,
    jumlah,
  };
}

function extractHeader(msg: string) {
  const iKat = msg.indexOf("📦 [");
  const iScale = msg.indexOf("⚖️ ", iKat);
  const iPrice = msg.indexOf("💰 Harga: Rp", iScale);
  const iLoc = msg.indexOf("📍 ", iPrice);
  const iKet = msg.indexOf("Ket: ", iLoc);
  return { iKat, iScale, iPrice, iLoc, iKet };
}

function extractScaleLine(msg: string) {
  const i = msg.indexOf("⚖️ ");
  const end = msg.indexOf("\n", i);
  return end < 0 ? msg.slice(i) : msg.slice(i, end);
}

function nonScaleFingerprint(msg: string) {
  const { iKat, iScale, iPrice, iLoc, iKet } = extractHeader(msg);
  return {
    kategori: msg.slice(iKat, msg.lastIndexOf("\n", iScale - 1)),
    price: msg.slice(iPrice, msg.lastIndexOf("\n", iLoc - 1)),
    lokasi: msg.slice(iLoc, msg.lastIndexOf("\n", iKet - 1)),
    ket: msg.slice(iKet),
  };
}

describe("buildPesan() — nama & lokasi SANGAT BESAR × switching satuan", () => {
  it.each(HUGE_SIZES)(
    "nama & lokasi ~%i karakter: struktur, isolasi baris, dan URL wa.me tetap valid",
    (size) => {
      const nama = buildHuge(size);
      const lokasi = buildHuge(size);

      // 1. Base = gram → snapshot fingerprint non-⚖️.
      const base = makeProduk(nama, lokasi, "gram", 250);
      const baseMsg = buildPesan(base);

      // Pesan minimal berisi nama & lokasi utuh — tidak ada truncation
      // yang dilakukan buildPesan atas nama besar.
      expect(baseMsg.length).toBeGreaterThanOrEqual(2 * size);
      expect(baseMsg).toContain(nama);
      expect(baseMsg).toContain(lokasi);

      const baseFp = nonScaleFingerprint(baseMsg);
      expect(extractScaleLine(baseMsg)).toBe(`⚖️ ${formatJumlah(250, "gram")}`);

      for (const s of ALL_SATUAN) {
        const jml = s === "gram" ? 250 : s === "kg" ? 2 : s === "sachet" ? 12 : 3;
        const p = { ...base, satuan: s, jumlah: jml };
        const msg = buildPesan(p);

        // (a) 5 header hadir & berurutan meski nama/lokasi puluhan-ribu karakter.
        const h = extractHeader(msg);
        expect(h.iKat, `size=${size} sat=${s} 📦 hilang`).toBeGreaterThanOrEqual(0);
        expect(h.iScale, `size=${size} sat=${s} ⚖️ hilang`).toBeGreaterThan(h.iKat);
        expect(h.iPrice, `size=${size} sat=${s} 💰 hilang`).toBeGreaterThan(h.iScale);
        expect(h.iLoc, `size=${size} sat=${s} 📍 hilang`).toBeGreaterThan(h.iPrice);
        expect(h.iKet, `size=${size} sat=${s} Ket: hilang`).toBeGreaterThan(h.iLoc);

        // (b) ⚖️ mengikuti satuan terbaru.
        expect(extractScaleLine(msg)).toBe(`⚖️ ${formatJumlah(jml, s)}`);

        // (c) Isolasi: baris non-⚖️ IDENTIK dengan base — nama besar tidak
        //     ikut berubah hanya karena satuan di-switch.
        const fp = nonScaleFingerprint(msg);
        expect(fp.kategori).toBe(baseFp.kategori);
        expect(fp.price).toBe(baseFp.price);
        expect(fp.lokasi).toBe(baseFp.lokasi);
        expect(fp.ket).toBe(baseFp.ket);

        // (d) URL wa.me tetap valid meski payload besar.
        const url = buildWhatsAppUrl(msg);
        expect(url.startsWith("https://wa.me/?text="), `size=${size} sat=${s} prefix wa.me`).toBe(true);

        // Parseable oleh WHATWG URL & hanya SATU query param 'text'.
        const u = new URL(url);
        expect([...u.searchParams.keys()]).toEqual(["text"]);

        const q = url.slice("https://wa.me/?text=".length);
        expect(q, `size=${size} sat=${s} spasi mentah`).not.toContain(" ");
        expect(q, `size=${size} sat=${s} newline mentah`).not.toContain("\n");
        expect(q, `size=${size} sat=${s} '#' mentah`).not.toContain("#");
        expect(q.split("&"), `size=${size} sat=${s} '&' bocor`).toHaveLength(1);

        // (e) Round-trip bit-exact.
        expect(
          u.searchParams.get("text"),
          `size=${size} sat=${s} round-trip berbeda`,
        ).toBe(msg);

        // (f) URL panjang skala linier ~ terhadap payload (sanity: tidak
        //     eksplode > 12× karena ada karakter yang butuh %XX%XX%XX%XX).
        expect(url.length).toBeLessThan(msg.length * 12 + 1024);
      }
    },
    /* per-case timeout for the 64K variant */ 30_000,
  );
});