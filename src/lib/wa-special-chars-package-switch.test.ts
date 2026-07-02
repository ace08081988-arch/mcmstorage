import { describe, it, expect } from "vitest";
import { buildWhatsAppUrl } from "@/lib/share-wa";
import {
  buildPesan,
  formatJumlah,
  type Produk,
  type Satuan,
} from "@/routes/_authenticated.index";

/**
 * Edge-case test: `buildPesan()` harus tetap valid saat *nama produk* dan
 * *lokasi* berisi karakter khusus (tanda kutip, emoji, simbol, newline,
 * tab, RTL, zero-width) ketika Jenis kemasan di-switch antara
 * gram ↔ kg ↔ botol ↔ pcs ↔ sachet ↔ lusin ↔ pak ↔ dus.
 *
 * Yang diverifikasi:
 *  1. Output tetap terstruktur (5 baris tetap: 📦, ⚖️, 💰, 📍, Ket:).
 *  2. Karakter khusus di `nama` & `lokasi` disalurkan verbatim (tidak
 *     hilang, tidak double-escaped).
 *  3. Baris ⚖️ SELALU mengikuti satuan terbaru — tak ada satuan lama
 *     yang "tersangkut" karena karakter khusus di field tetangga.
 *  4. Ketika payload dibungkus ke `wa.me`, hasil decode(url) bit-exact
 *     identik dengan `buildPesan()` sumbernya.
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

const SPECIAL_NAMES = [
  { label: "smart quotes", value: `Beras “Super” ‘Premium’` },
  { label: "straight quotes + apostrophe", value: `O"Brien's "Kopi" Toko` },
  { label: "emoji + zwj", value: `🌾 Beras 👨‍🌾 Petani 🇮🇩` },
  { label: "math & currency symbols", value: `Gula ± 500g @ Rp1.000 №1 €¥$` },
  { label: "URL / hash / query", value: `Item #12 & ?q=1 https://a.b/c?x=1&y=2` },
  { label: "newline & tab", value: `Baris1\nBaris2\tKolom` },
  { label: "RTL Arabic", value: `أرز بسمتي` },
  { label: "CJK", value: `米 (Beras) 白米` },
  { label: "zero-width joiner + non-breaking space", value: `A\u200D\u00A0B` },
  { label: "backslash & backtick", value: "Path\\to\\item `code`" },
  { label: "angle brackets & braces", value: `<script>{alert(1)}</script>` },
  { label: "control chars stripped-safe", value: `Bel\u0007End` },
];

const SPECIAL_LOCATIONS = [
  `Rak "A" / lantai 2`,
  `📍 Gudang #3 & 4`,
  `Lokasi\nMulti\nBaris`,
  `مخزن ١`,
  `倉庫-3`,
  `Rak\tTab\tArea`,
  `Rak <A> {sub-01}`,
  `Zone\u200B\u200DX`, // zero-width chars
];

function makeProduk(nama: string, lokasi: string, satuan: Satuan, jumlah: number): Produk {
  return {
    id: 1,
    kategori: "Sembako",
    nama,
    harga: 25_500,
    status: "Belum Dikirim",
    keterangan: "Ket dengan \"kutip\" & emoji 🎯",
    lokasi,
    satuan,
    jumlah,
  };
}

function decodeWaText(url: string): string {
  const u = new URL(url);
  const raw = u.searchParams.get("text");
  expect(raw).not.toBeNull();
  return raw!;
}

function extractLines(msg: string) {
  const lines = msg.split("\n");
  return {
    kategori: lines[0] ?? "",
    scale: lines[1] ?? "",
    price: lines[2] ?? "",
    lokasi: lines[3] ?? "",
    ket: lines[4] ?? "",
    all: lines,
  };
}

describe("buildPesan() tetap valid dengan karakter khusus + package switch", () => {
  it("struktur 5-baris terjaga untuk SEMUA kombinasi nama × satuan", () => {
    for (const nm of SPECIAL_NAMES) {
      for (const s of ALL_SATUAN) {
        const p = makeProduk(nm.value, "Rak A/1", s, 3);
        const msg = buildPesan(p);
        // Selalu 5 bagian dipisah "\n"; kalau nama/keterangan/lokasi
        // mengandung "\n" mentah, jumlah baris akan LEBIH dari 5.
        // Yang penting: kelima *header* baris muncul BERURUTAN.
        const idxKat = msg.indexOf("📦 [Sem]");
        const idxScale = msg.indexOf("⚖️ ", idxKat);
        const idxPrice = msg.indexOf("💰 Harga: Rp", idxScale);
        const idxLoc = msg.indexOf("📍 ", idxPrice);
        const idxKet = msg.indexOf("Ket: ", idxLoc);
        expect(idxKat, `[${nm.label} / ${s}] 📦 hilang`).toBeGreaterThanOrEqual(0);
        expect(idxScale, `[${nm.label} / ${s}] ⚖️ hilang`).toBeGreaterThan(idxKat);
        expect(idxPrice, `[${nm.label} / ${s}] 💰 hilang`).toBeGreaterThan(idxScale);
        expect(idxLoc, `[${nm.label} / ${s}] 📍 hilang`).toBeGreaterThan(idxPrice);
        expect(idxKet, `[${nm.label} / ${s}] Ket: hilang`).toBeGreaterThan(idxLoc);

        // Baris ⚖️ (dari "⚖️ " sampai "\n" terdekat setelahnya) mengikuti satuan.
        const scaleEnd = msg.indexOf("\n", idxScale);
        const scaleLine = msg.slice(idxScale, scaleEnd);
        expect(scaleLine).toBe(`⚖️ ${formatJumlah(3, s)}`);
      }
    }
  });

  it("nama & lokasi karakter khusus disalurkan verbatim (tidak double-escaped)", () => {
    for (const nm of SPECIAL_NAMES) {
      for (const loc of SPECIAL_LOCATIONS) {
        const p = makeProduk(nm.value, loc, "gram", 500);
        const msg = buildPesan(p);
        // Nama muncul dalam wrapper `*...*` — verbatim.
        expect(msg).toContain(`*${nm.value}*`);
        // Lokasi verbatim setelah "📍 ".
        expect(msg).toContain(`📍 ${loc}`);
        // Tidak ada escape ganda: `\\n`, `\\"`, HTML entity, atau URL-encode.
        expect(msg).not.toMatch(/\\n(?!ame)/); // hindari false-match ke kata "name"
        expect(msg).not.toContain('\\"');
        expect(msg).not.toContain("&quot;");
        expect(msg).not.toContain("&amp;");
        expect(msg).not.toContain("%20");
      }
    }
  });

  it("switch satuan gram ↔ botol/pcs/sachet dengan nama+lokasi ekstrem: hanya baris ⚖️ berubah", () => {
    const targets: Satuan[] = ["gram", "botol", "pcs", "sachet"];
    for (const nm of SPECIAL_NAMES) {
      for (const loc of SPECIAL_LOCATIONS) {
        const base = makeProduk(nm.value, loc, "gram", 250);
        const baseMsg = buildPesan(base);
        const baseLines = extractLines(baseMsg);

        for (const s of targets) {
          const jml = s === "gram" ? 250 : s === "sachet" ? 10 : 3;
          const p = { ...base, satuan: s, jumlah: jml };
          const msg = buildPesan(p);
          const lines = extractLines(msg);

          // Baris NON-⚖️ IDENTIK — nama/lokasi/keterangan tidak boleh berubah
          // hanya karena satuan di-switch.
          expect(lines.kategori).toBe(baseLines.kategori);
          expect(lines.price).toBe(baseLines.price);
          expect(lines.lokasi).toBe(baseLines.lokasi);
          expect(lines.ket).toBe(baseLines.ket);

          // Baris ⚖️ mengikuti satuan terbaru — no artefak lama.
          expect(lines.scale).toBe(`⚖️ ${formatJumlah(jml, s)}`);

          // Anti-leak: setelah switch ke non-gram, TIDAK boleh muncul
          // literal "250 g" (satuan gram lama) di manapun.
          if (s !== "gram") {
            expect(msg).not.toContain(`⚖️ 250 g`);
          }
        }
      }
    }
  });

  it("round-trip wa.me: decode(url) === buildPesan(p) untuk semua nama×lokasi×satuan", () => {
    // Ambil subset representatif agar tetap cepat: 3 nama × 3 lokasi × semua satuan.
    const names = SPECIAL_NAMES.slice(0, 3);
    const locs = SPECIAL_LOCATIONS.slice(0, 3);
    for (const nm of names) {
      for (const loc of locs) {
        for (const s of ALL_SATUAN) {
          const p = makeProduk(nm.value, loc, s, 2);
          const expected = buildPesan(p);
          const url = buildWhatsAppUrl(expected);
          // Query string tidak boleh berisi karakter unsafe mentah.
          const q = url.slice("https://wa.me/?text=".length);
          expect(q, `[${nm.label} / ${loc} / ${s}] spasi mentah`).not.toContain(" ");
          expect(q, `[${nm.label} / ${loc} / ${s}] newline mentah`).not.toContain("\n");
          expect(q, `[${nm.label} / ${loc} / ${s}] '#' mentah`).not.toContain("#");
          // Hanya SATU parameter — '&' pada nama/lokasi harus ter-encode.
          expect(q.split("&"), `[${nm.label} / ${loc} / ${s}] param bocor`).toHaveLength(1);
          // Round-trip identik.
          expect(decodeWaText(url)).toBe(expected);
        }
      }
    }
  });

  it("nama/lokasi kosong atau whitespace-only tetap menghasilkan 5 baris terstruktur", () => {
    const cases = [
      { nama: "", loc: "" },
      { nama: "   ", loc: "\t" },
      { nama: "\n", loc: "\n\n" },
      { nama: "🎯", loc: "🏬" },
    ];
    for (const c of cases) {
      for (const s of ALL_SATUAN) {
        const msg = buildPesan(makeProduk(c.nama, c.loc, s, 1));
        // Header baris masih terdeteksi berurutan.
        expect(msg.indexOf("📦 [")).toBe(0);
        expect(msg).toContain(`⚖️ ${formatJumlah(1, s)}`);
        expect(msg).toContain("💰 Harga: Rp");
        expect(msg).toContain("📍 ");
        expect(msg).toContain("Ket: ");
        // Round-trip WA masih valid.
        const url = buildWhatsAppUrl(msg);
        expect(decodeWaText(url)).toBe(msg);
      }
    }
  });
});