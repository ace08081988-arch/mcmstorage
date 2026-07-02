import { describe, it, expect } from "vitest";
import { buildWhatsAppUrl } from "@/lib/share-wa";
import {
  buildPesan,
  formatJumlah,
  type Produk,
  type Satuan,
} from "@/routes/_authenticated.index";

/**
 * FUZZ TEST: `buildPesan()` harus tetap valid & bit-exact round-trippable
 * lewat `wa.me` untuk *nama produk*, *lokasi*, dan *keterangan* yang berisi
 * karakter Unicode acak yang ekstrem — campuran BMP + astral, ZWJ / ZWNJ /
 * ZWSP / BOM, bidi mark (LRM/RLM/LRE/RLE/PDF/LRI/RLI/PDI), whitespace
 * eksotik, kontrol karakter, backslash, kutip, tag HTML-shape — saat
 * satuan di-switch antara `gram ↔ kg ↔ botol ↔ pcs ↔ sachet ↔ lusin ↔ pak ↔ dus`.
 *
 * Tujuan: menangkap regresi di mana karakter tertentu menyebabkan
 *  - baris ⚖️ hilang / tergeser posisinya,
 *  - satuan LAMA "nyangkut" karena string tetangga tidak ter-terminate,
 *  - `wa.me` encoding kehilangan/menduplikasi byte,
 *  - baris non-⚖️ ikut berubah waktu switching (isolasi baris).
 *
 * Deterministik: PRNG di-seed konstan supaya CI reproducible; naikkan
 * `FUZZ_ITERATIONS` untuk lokal soak-test.
 */

const ALL_SATUAN: Satuan[] = [
  "gram",
  "kg",
  "botol",
  "sachet",
  "pcs",
  "lusin",
  "pak",
  "dus",
];

const FUZZ_ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 200);
const FUZZ_SEED = Number(process.env.FUZZ_SEED ?? 0xC0FFEE);

// -------- Deterministic PRNG (mulberry32) -----------------------------------
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -------- Character pools ---------------------------------------------------
const ZERO_WIDTH = [
  "\u200B", // ZWSP
  "\u200C", // ZWNJ
  "\u200D", // ZWJ
  "\uFEFF", // BOM / ZWNBSP
  "\u2060", // WORD JOINER
];
const BIDI_MARKS = [
  "\u200E", // LRM
  "\u200F", // RLM
  "\u202A", // LRE
  "\u202B", // RLE
  "\u202C", // PDF
  "\u202D", // LRO
  "\u202E", // RLO
  "\u2066", // LRI
  "\u2067", // RLI
  "\u2068", // FSI
  "\u2069", // PDI
];
const RTL_LETTERS = "ابتثجحخدذرزسشصضطظعغفقكلمنهويأإآؤئءةىﻻאבגדהוזחטיכלמנסעפצקרשת".split("");
const CJK_LETTERS = "米飯麵油鹽糖麥豆茶咖啡水糧倉庫貨物件品箱袋瓶罐斤兩克千萬億".split("");
const EMOJI = [
  "🌾","🍚","🍱","🥫","🧂","🧴","🧃","🍶","📦","📍","⚖️","💰","🎯",
  "🏬","🚚","🏷️","🇮🇩","🇸🇬","🇯🇵","👨‍🌾","👩‍🍳","👨‍👩‍👧",
];
const EXOTIC_WS = ["\t", "\n", "\r", "\u00A0", "\u2028", "\u2029", "\u3000", "\u202F"];
const CONTROL = ["\u0001", "\u0007", "\u000B", "\u001B", "\u007F"];
const PUNCT = [
  '"', "'", "`", "\\", "/", "|", "&", "#", "?", "=", "%", "@",
  "<", ">", "{", "}", "[", "]", "(", ")", "*", "+", "~", "^", "$", ".", ",", ";", ":", "!",
  "“", "”", "‘", "’", "«", "»", "…", "—", "–", "№", "€", "¥", "£", "±",
];

function pickAstral(rng: () => number): string {
  // Random Supplementary Multilingual Plane codepoint (emoji-ish range
  // 0x1F300–0x1F9FF). Uses fromCodePoint so it's a valid surrogate pair.
  const cp = 0x1F300 + Math.floor(rng() * (0x1F9FF - 0x1F300));
  return String.fromCodePoint(cp);
}

function randomChunk(rng: () => number): string {
  const buckets: Array<(r: () => number) => string> = [
    (r) => ZERO_WIDTH[Math.floor(r() * ZERO_WIDTH.length)],
    (r) => BIDI_MARKS[Math.floor(r() * BIDI_MARKS.length)],
    (r) => RTL_LETTERS[Math.floor(r() * RTL_LETTERS.length)],
    (r) => CJK_LETTERS[Math.floor(r() * CJK_LETTERS.length)],
    (r) => EMOJI[Math.floor(r() * EMOJI.length)],
    (r) => EXOTIC_WS[Math.floor(r() * EXOTIC_WS.length)],
    (r) => CONTROL[Math.floor(r() * CONTROL.length)],
    (r) => PUNCT[Math.floor(r() * PUNCT.length)],
    (r) => pickAstral(r),
    (r) => String.fromCharCode(0x41 + Math.floor(r() * 26)), // ASCII letter
    (r) => String.fromCharCode(0x30 + Math.floor(r() * 10)), // ASCII digit
  ];
  return buckets[Math.floor(rng() * buckets.length)](rng);
}

function fuzzString(rng: () => number, minLen = 0, maxLen = 40): string {
  const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
  let out = "";
  for (let i = 0; i < len; i++) out += randomChunk(rng);
  return out;
}

// -------- Extractor: header baris tanpa terganggu newline mentah ------------
function extractHeader(msg: string) {
  const iKat = msg.indexOf("📦 [");
  const iScale = msg.indexOf("⚖️ ", iKat);
  const iPrice = msg.indexOf("💰 Harga: Rp", iScale);
  const iLoc = msg.indexOf("📍 ", iPrice);
  const iKet = msg.indexOf("Ket: ", iLoc);
  return { iKat, iScale, iPrice, iLoc, iKet };
}

function extractScaleLine(msg: string): string {
  const i = msg.indexOf("⚖️ ");
  if (i < 0) return "";
  const end = msg.indexOf("\n", i);
  return end < 0 ? msg.slice(i) : msg.slice(i, end);
}

function extractNonScaleFingerprint(msg: string) {
  // Ambil baris kategori/price/lokasi/ket sebagai fingerprint. Setiap header
  // dibatasi oleh newline yang DITULIS `buildPesan` — yaitu newline tepat
  // sebelum marker berikutnya.
  const { iKat, iScale, iPrice, iLoc, iKet } = extractHeader(msg);
  if ([iKat, iScale, iPrice, iLoc, iKet].some((x) => x < 0)) return null;
  return {
    kategori: msg.slice(iKat, msg.lastIndexOf("\n", iScale - 1)),
    price: msg.slice(iPrice, msg.lastIndexOf("\n", iLoc - 1)),
    lokasi: msg.slice(iLoc, msg.lastIndexOf("\n", iKet - 1)),
    ket: msg.slice(iKet),
  };
}

function makeProduk(
  nama: string,
  lokasi: string,
  keterangan: string,
  satuan: Satuan,
  jumlah: number,
): Produk {
  return {
    id: 1,
    kategori: "Sembako",
    nama,
    harga: 12_345,
    status: "Belum Dikirim",
    keterangan,
    lokasi,
    satuan,
    jumlah,
  };
}

describe("buildPesan() FUZZ — Unicode ekstrem + package switch", () => {
  it(`struktur & isolasi baris tetap valid untuk ${FUZZ_ITERATIONS} iterasi acak`, () => {
    const rng = makeRng(FUZZ_SEED);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const nama = fuzzString(rng, 0, 32);
      const lokasi = fuzzString(rng, 0, 24);
      const keterangan = fuzzString(rng, 0, 24);

      // 1. Base = gram, snapshot fingerprint non-⚖️.
      const base = makeProduk(nama, lokasi, keterangan, "gram", 250);
      const baseMsg = buildPesan(base);
      const baseFp = extractNonScaleFingerprint(baseMsg);
      expect(
        baseFp,
        `iter=${i} seed=${FUZZ_SEED} nama=${JSON.stringify(nama)} — header 5-baris tidak terdeteksi di base`,
      ).not.toBeNull();

      // Base ⚖️ line konsisten dgn formatJumlah.
      expect(extractScaleLine(baseMsg)).toBe(`⚖️ ${formatJumlah(250, "gram")}`);

      // 2. Switch ke SEMUA satuan lain — non-⚖️ harus identik, ⚖️ mengikuti.
      for (const s of ALL_SATUAN) {
        const jml = s === "gram" ? 250 : s === "kg" ? 2 : s === "sachet" ? 12 : 3;
        const p = { ...base, satuan: s, jumlah: jml };
        const msg = buildPesan(p);

        // 5 marker header masih hadir & terurut.
        const h = extractHeader(msg);
        expect(h.iKat, `iter=${i} sat=${s} 📦 hilang`).toBeGreaterThanOrEqual(0);
        expect(h.iScale, `iter=${i} sat=${s} ⚖️ hilang`).toBeGreaterThan(h.iKat);
        expect(h.iPrice, `iter=${i} sat=${s} 💰 hilang`).toBeGreaterThan(h.iScale);
        expect(h.iLoc, `iter=${i} sat=${s} 📍 hilang`).toBeGreaterThan(h.iPrice);
        expect(h.iKet, `iter=${i} sat=${s} Ket: hilang`).toBeGreaterThan(h.iLoc);

        // ⚖️ line = formatJumlah TERBARU — tidak ada artefak satuan lama.
        expect(
          extractScaleLine(msg),
          `iter=${i} sat=${s} scale line tidak sinkron`,
        ).toBe(`⚖️ ${formatJumlah(jml, s)}`);

        // Anti-leak: jika bukan gram, string "⚖️ 250 g" tak boleh muncul.
        if (s !== "gram") {
          expect(
            msg.includes("⚖️ 250 g\n") || msg.endsWith("⚖️ 250 g"),
            `iter=${i} sat=${s} — jejak satuan gram lama bocor`,
          ).toBe(false);
        }

        // Baris non-⚖️ IDENTIK dengan base — switching satuan tidak boleh
        // menggeser nama/lokasi/keterangan/harga.
        const fp = extractNonScaleFingerprint(msg);
        expect(fp, `iter=${i} sat=${s} — header hilang setelah switch`).not.toBeNull();
        expect(fp!.kategori).toBe(baseFp!.kategori);
        expect(fp!.price).toBe(baseFp!.price);
        expect(fp!.lokasi).toBe(baseFp!.lokasi);
        expect(fp!.ket).toBe(baseFp!.ket);

        // 3. Round-trip wa.me — decode(url) === buildPesan(p) bit-exact.
        const url = buildWhatsAppUrl(msg);
        const decoded = new URL(url).searchParams.get("text");
        expect(
          decoded,
          `iter=${i} sat=${s} — round-trip wa.me tidak identik`,
        ).toBe(msg);

        // Query string tidak boleh berisi karakter unsafe mentah setelah encode.
        const q = url.slice("https://wa.me/?text=".length);
        expect(q, `iter=${i} sat=${s} spasi mentah`).not.toContain(" ");
        expect(q, `iter=${i} sat=${s} newline mentah`).not.toContain("\n");
        expect(q, `iter=${i} sat=${s} '#' mentah`).not.toContain("#");
        expect(
          q.split("&"),
          `iter=${i} sat=${s} — '&' bocor jadi param baru`,
        ).toHaveLength(1);
      }
    }
  });
});