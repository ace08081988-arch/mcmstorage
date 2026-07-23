import { describe, expect, it } from "vitest";
import { buildWhatsAppUrl, buildWhatsAppBusinessIntentUrl } from "./share-wa";

/**
 * Kontrak encodeURIComponent untuk pesan WA:
 *   - Spasi → %20 (BUKAN "+"), karena "+" tidak di-decode balik jadi spasi
 *     oleh sebagian WA client dan pesan jadi rusak.
 *   - Karakter khusus (& = ? # / newline emoji dsb) HARUS ter-escape supaya
 *     tidak memutus query string atau bocor ke fragment `#Intent;...`.
 *   - Round-trip decodeURIComponent HARUS menghasilkan teks aslinya.
 *   - Panjang teks apa pun tidak boleh memutus struktur URL.
 */

function extractText(url: string): string {
  // wa.me → ambil query text=
  const m = url.match(/[?&]text=([^&#]*)/);
  if (!m) throw new Error(`no text param in url: ${url}`);
  return decodeURIComponent(m[1]);
}

function extractIntentText(url: string): string {
  // intent:// URL: text= sebelum '#Intent;...'
  const beforeFragment = url.split("#")[0];
  return extractText(beforeFragment);
}

const SPECIAL_TEXTS: Array<{ label: string; text: string }> = [
  { label: "ampersand+equals+question", text: "Kacang & Gula = 10.000? Ya!" },
  { label: "hash+slash", text: "Cek #promo di /toko utama" },
  { label: "newlines+tabs", text: "Baris 1\nBaris 2\tKolom" },
  { label: "quotes+backslash", text: "Nama: \"Kopi 'Robusta'\" \\ premium" },
  { label: "unicode+emoji", text: "Kopi ☕ premium — Rp10.000 (naïve café) 🇮🇩" },
  { label: "arabic+cjk", text: "المتجر 商店 — Kacang" },
  { label: "url in text", text: "Lihat: https://example.com/p?x=1&y=2#top" },
  { label: "plus signs", text: "1+1 = 2 (bonus +10%)" },
  { label: "percent literal", text: "Diskon 20% + cashback 100%" },
  { label: "html-ish", text: "<script>alert('x')</script> & <b>bold</b>" },
  { label: "control chars", text: "A\u0000B\u001FC" },
  { label: "empty", text: "" },
  { label: "only spaces", text: "     " },
];

describe("buildWhatsAppUrl — encodeURIComponent aman untuk karakter khusus", () => {
  it.each(SPECIAL_TEXTS)("wa.me round-trip utuh: $label", ({ text }) => {
    const url = buildWhatsAppUrl(text, "628123456789");
    expect(url.startsWith("https://wa.me/628123456789?text=")).toBe(true);
    expect(extractText(url)).toBe(text);
  });

  it.each(SPECIAL_TEXTS)("wa.me tanpa phone → base '/' + text ter-encode: $label", ({ text }) => {
    const url = buildWhatsAppUrl(text);
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(extractText(url)).toBe(text);
  });

  it("spasi di-encode sebagai %20, BUKAN '+'", () => {
    const url = buildWhatsAppUrl("kacang tanah 500 gram", "628");
    expect(url).toContain("%20");
    // Setelah '?text=' tidak boleh ada '+' literal yang menggantikan spasi.
    const q = url.split("?text=")[1];
    expect(q.includes("+")).toBe(false);
  });

  it("'&', '=', '#' di teks tidak memutus query string wa.me", () => {
    const text = "A & B = C # D";
    const url = buildWhatsAppUrl(text, "628");
    // Hanya ada satu '?' (pemisah query) dan tidak ada '#' fragment.
    expect(url.split("?").length).toBe(2);
    expect(url.includes("#")).toBe(false);
    expect(extractText(url)).toBe(text);
  });

  it("angka HP di-strip non-digit sebelum masuk path", () => {
    const url = buildWhatsAppUrl("hi", "+62 812-3456-7890");
    expect(url.startsWith("https://wa.me/6281234567890?text=")).toBe(true);
  });

  it("nama produk dengan karakter khusus tidak bocor sebagai param baru", () => {
    const productName = "Kopi Arabika (250g) & Susu = enak";
    const caption = `Pesanan: ${productName}\nTotal: Rp25.000`;
    const url = buildWhatsAppUrl(caption, "628");
    // Tidak boleh ada param kedua akibat '&' bocor.
    const params = url.split("?text=")[1].split("&");
    expect(params.length).toBe(1);
    expect(extractText(url)).toBe(caption);
  });
});

describe("buildWhatsAppBusinessIntentUrl — encoding aman untuk intent://", () => {
  it.each(SPECIAL_TEXTS)("intent round-trip utuh: $label", ({ text }) => {
    const url = buildWhatsAppBusinessIntentUrl(text, "628123456789");
    expect(url.startsWith("intent://send?")).toBe(true);
    expect(url.includes("#Intent;")).toBe(true);
    expect(url.includes(";end")).toBe(true);
    expect(extractIntentText(url)).toBe(text);
  });

  it("teks TIDAK boleh bocor ke fragment '#Intent;...' (memicu intent salah)", () => {
    const url = buildWhatsAppBusinessIntentUrl("A#Intent;package=evil;end B", "628");
    // Ambil fragment setelah '#' pertama — harus dimulai 'Intent;'
    const hashIdx = url.indexOf("#");
    expect(hashIdx).toBeGreaterThan(-1);
    const fragment = url.slice(hashIdx + 1);
    expect(fragment.startsWith("Intent;")).toBe(true);
    // Package tetap com.whatsapp.w4b, bukan yang disuntik.
    expect(fragment).toContain("package=com.whatsapp.w4b");
    expect(fragment).not.toContain("package=evil");
  });

  it("';' dan '=' dalam teks tidak memecah struktur intent params", () => {
    const text = "a;b=c;end;package=x";
    const url = buildWhatsAppBusinessIntentUrl(text, "628");
    expect(extractIntentText(url)).toBe(text);
    // Query utama sebelum '#' hanya berisi phone= dan text=
    const beforeHash = url.split("#")[0];
    const query = beforeHash.split("?")[1];
    const keys = query.split("&").map((kv) => kv.split("=")[0]).sort();
    expect(keys).toEqual(["phone", "text"]);
  });

  it("fallback URL di S.browser_fallback_url ikut ter-encode (percent-encoded)", () => {
    const url = buildWhatsAppBusinessIntentUrl("hi & bye", "628");
    // 'https://' menjadi 'https%3A%2F%2F' setelah encode.
    expect(url).toContain("S.browser_fallback_url=https%3A%2F%2Fwa.me");
  });

  it("phone dihilangkan dari intent jika kosong", () => {
    const url = buildWhatsAppBusinessIntentUrl("hi", "");
    expect(url.startsWith("intent://send?text=")).toBe(true);
  });
});

describe("Fuzz ringan — encoding tetap round-trip untuk string acak", () => {
  // Split by codepoint so surrogate pairs (emoji) stay atomic —
  // indexing per UTF-16 unit would break lone halves and blow up encodeURIComponent.
  const CHARS = Array.from("ABCabc012 &=?#/+%\"'\\<>\n\t☕🇮🇩商店 المتجر");
  function randomText(len: number, seed: number): string {
    let s = "";
    let x = seed;
    for (let i = 0; i < len; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      s += CHARS[x % CHARS.length];
    }
    return s;
  }

  it("100 sampel acak → decode(text) === text di wa.me & intent", () => {
    for (let i = 0; i < 100; i++) {
      const t = randomText(1 + (i % 40), i + 1);
      expect(extractText(buildWhatsAppUrl(t, "628"))).toBe(t);
      expect(extractIntentText(buildWhatsAppBusinessIntentUrl(t, "628"))).toBe(t);
    }
  });
});
