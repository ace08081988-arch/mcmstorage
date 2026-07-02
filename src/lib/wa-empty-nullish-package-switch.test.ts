import { describe, it, expect } from "vitest";
import { buildWhatsAppUrl } from "@/lib/share-wa";
import {
  buildPesan,
  formatJumlah,
  type Produk,
  type Satuan,
} from "@/routes/_authenticated.index";

/**
 * EDGE CASE — `nama` / `lokasi` **kosong atau nullish** (empty string,
 * whitespace-only, `null`, `undefined`) tidak boleh:
 *   1. Melempar exception dari `buildPesan()`.
 *   2. Merusak struktur 5-baris (📦 / ⚖️ / 💰 / 📍 / Ket:).
 *   3. Memutus / mengaburkan URL `wa.me` — hasil harus parseable oleh
 *      WHATWG URL, tepat satu param `text`, dan round-trip bit-exact.
 *   4. Ikut berubah hanya karena satuan di-switch antara
 *      `gram ↔ botol/pcs/sachet` (baris non-⚖️ tetap identik).
 *
 * Meskipun tipe `Produk` mendeklarasikan `nama: string` & `lokasi: string`,
 * data yang datang dari DB / IPC bisa saja `null` di jalur error path
 * (mis. row lama, seed script). Test ini mengunci kontrak defensifnya.
 */

const SWITCH_TARGETS: Satuan[] = ["gram", "botol", "pcs", "sachet"];

type NullishProduk = Omit<Produk, "nama" | "lokasi"> & {
  nama: string | null | undefined;
  lokasi: string | null | undefined;
};

function makeProduk(
  nama: string | null | undefined,
  lokasi: string | null | undefined,
  satuan: Satuan,
  jumlah: number,
): Produk {
  // Cast lewat NullishProduk agar test dengan sengaja mengirim null/undefined
  // sebagai simulasi data cacat dari DB — tanpa mematikan seluruh type-check.
  const p: NullishProduk = {
    id: 1,
    kategori: "Sembako",
    nama,
    harga: 15_000,
    status: "Belum Dikirim",
    keterangan: "",
    lokasi,
    satuan,
    jumlah,
  };
  return p as Produk;
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

// Nilai nama/lokasi yang kita anggap "kosong" dari sisi user.
const EMPTY_LIKE: Array<{ label: string; value: string | null | undefined }> = [
  { label: "empty string", value: "" },
  { label: "spaces", value: "   " },
  { label: "tab", value: "\t" },
  { label: "newlines", value: "\n\n" },
  { label: "CRLF", value: "\r\n" },
  { label: "NBSP", value: "\u00A0" },
  { label: "zero-width joiner", value: "\u200D" },
  { label: "BOM", value: "\uFEFF" },
  { label: "null", value: null },
  { label: "undefined", value: undefined },
];

describe("buildPesan() — nama/lokasi kosong atau nullish + switching satuan", () => {
  it("tidak melempar exception untuk semua kombinasi kosong/nullish × satuan", () => {
    for (const nm of EMPTY_LIKE) {
      for (const lc of EMPTY_LIKE) {
        for (const s of SWITCH_TARGETS) {
          const jml = s === "gram" ? 250 : s === "sachet" ? 12 : 3;
          expect(
            () => buildPesan(makeProduk(nm.value, lc.value, s, jml)),
            `nama=${nm.label} lokasi=${lc.label} sat=${s} — buildPesan throw`,
          ).not.toThrow();
        }
      }
    }
  });

  it("struktur 5-baris tetap ada dan ⚖️ mengikuti satuan terbaru", () => {
    for (const nm of EMPTY_LIKE) {
      for (const lc of EMPTY_LIKE) {
        for (const s of SWITCH_TARGETS) {
          const jml = s === "gram" ? 250 : s === "sachet" ? 12 : 3;
          const msg = buildPesan(makeProduk(nm.value, lc.value, s, jml));

          const h = extractHeader(msg);
          expect(h.iKat, `nama=${nm.label} lok=${lc.label} sat=${s} 📦`).toBeGreaterThanOrEqual(0);
          expect(h.iScale, `nama=${nm.label} lok=${lc.label} sat=${s} ⚖️`).toBeGreaterThan(h.iKat);
          expect(h.iPrice, `nama=${nm.label} lok=${lc.label} sat=${s} 💰`).toBeGreaterThan(h.iScale);
          expect(h.iLoc, `nama=${nm.label} lok=${lc.label} sat=${s} 📍`).toBeGreaterThan(h.iPrice);
          expect(h.iKet, `nama=${nm.label} lok=${lc.label} sat=${s} Ket:`).toBeGreaterThan(h.iLoc);

          expect(extractScaleLine(msg)).toBe(`⚖️ ${formatJumlah(jml, s)}`);

          // Tidak boleh muncul literal "null" atau "undefined" yang bocor
          // dari coercion `${value}` — user tidak boleh melihatnya.
          expect(msg, `nama=${nm.label} lok=${lc.label} sat=${s} — leak 'null'`).not.toContain("null");
          expect(msg, `nama=${nm.label} lok=${lc.label} sat=${s} — leak 'undefined'`).not.toContain("undefined");
        }
      }
    }
  });

  it("switch gram ↔ botol/pcs/sachet: baris non-⚖️ identik meski nama/lokasi kosong-nullish", () => {
    for (const nm of EMPTY_LIKE) {
      for (const lc of EMPTY_LIKE) {
        const base = makeProduk(nm.value, lc.value, "gram", 250);
        const baseMsg = buildPesan(base);
        const baseFp = nonScaleFingerprint(baseMsg);

        for (const s of SWITCH_TARGETS) {
          const jml = s === "gram" ? 250 : s === "sachet" ? 12 : 3;
          const msg = buildPesan({ ...base, satuan: s, jumlah: jml });
          const fp = nonScaleFingerprint(msg);

          expect(fp.kategori).toBe(baseFp.kategori);
          expect(fp.price).toBe(baseFp.price);
          expect(fp.lokasi).toBe(baseFp.lokasi);
          expect(fp.ket).toBe(baseFp.ket);
          expect(extractScaleLine(msg)).toBe(`⚖️ ${formatJumlah(jml, s)}`);
        }
      }
    }
  });

  it("URL wa.me tetap terbentuk & round-trip bit-exact untuk semua kombinasi kosong/nullish", () => {
    for (const nm of EMPTY_LIKE) {
      for (const lc of EMPTY_LIKE) {
        for (const s of SWITCH_TARGETS) {
          const jml = s === "gram" ? 250 : s === "sachet" ? 12 : 3;
          const msg = buildPesan(makeProduk(nm.value, lc.value, s, jml));

          const url = buildWhatsAppUrl(msg);
          expect(
            url.startsWith("https://wa.me/?text="),
            `nama=${nm.label} lok=${lc.label} sat=${s} — prefix wa.me hilang`,
          ).toBe(true);

          // Parseable & hanya satu query param.
          const u = new URL(url);
          expect([...u.searchParams.keys()]).toEqual(["text"]);

          const q = url.slice("https://wa.me/?text=".length);
          expect(q, `nama=${nm.label} lok=${lc.label} sat=${s} spasi mentah`).not.toContain(" ");
          expect(q, `nama=${nm.label} lok=${lc.label} sat=${s} newline mentah`).not.toContain("\n");
          expect(q, `nama=${nm.label} lok=${lc.label} sat=${s} '#' mentah`).not.toContain("#");
          expect(
            q.split("&"),
            `nama=${nm.label} lok=${lc.label} sat=${s} '&' bocor`,
          ).toHaveLength(1);

          expect(
            u.searchParams.get("text"),
            `nama=${nm.label} lok=${lc.label} sat=${s} round-trip berbeda`,
          ).toBe(msg);
        }
      }
    }
  });
});