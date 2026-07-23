/**
 * Kontrak: `buildWhatsAppUrl` HARUS menghasilkan URL wa.me yang valid dari
 * berbagai bentuk nomor yang mungkin sudah tersimpan di database (nomor lokal
 * dengan trunk "0", format internasional dengan "+62", "00", atau spasi/hyphen).
 * Bila `countryCode` diteruskan, semua bentuk tersebut harus jatuh ke digit
 * E.164 yang sama; tanpa `countryCode` (backward compat) hanya non-digit yang
 * dibuang.
 */
import { describe, expect, it } from "vitest";
import { buildWhatsAppUrl, buildWhatsAppBusinessIntentUrl } from "./share-wa";

function extractPhone(url: string): string {
  const m = url.match(/wa\.me\/(\d+)/);
  return m ? m[1] : "";
}

function extractIntentPhone(url: string): string {
  const m = url.match(/phone=(\d+)/);
  return m ? m[1] : "";
}

describe("buildWhatsAppUrl — normalisasi nomor per kode negara", () => {
  const ID_VARIANTS = [
    "081234567890",
    "0812-3456-7890",
    "+62 812-3456-7890",
    "62 812 3456 7890",
    "0062812 3456 7890",
    "812 3456 7890",
  ];

  it("ID: semua varian jatuh ke 62812... yang sama", () => {
    const targets = ID_VARIANTS.map((v) => extractPhone(buildWhatsAppUrl("halo", v, "ID")));
    for (const t of targets) expect(t).toBe("62812345678900".slice(0, 13));
  });

  it("MY: '0123456789' → '60123456789' (buang trunk 0, pasang dial 60)", () => {
    expect(extractPhone(buildWhatsAppUrl("halo", "0123456789", "MY"))).toBe("60123456789");
  });

  it("SG (tanpa trunk): '91234567' → '6591234567' (pasang dial saja)", () => {
    expect(extractPhone(buildWhatsAppUrl("halo", "91234567", "SG"))).toBe("6591234567");
  });

  it("US: '(415) 555-2671' → '14155552671' (trunk 1 di-detect, tidak double-1)", () => {
    expect(extractPhone(buildWhatsAppUrl("halo", "(415) 555-2671", "US"))).toBe("14155552671");
  });

  it("Nomor sudah E.164 tetap utuh apapun negaranya", () => {
    expect(extractPhone(buildWhatsAppUrl("halo", "6281234567890", "MY"))).toBe("6281234567890");
  });

  it("intent:// (WA Business) juga ikut normalisasi bila countryCode diberi", () => {
    const url = buildWhatsAppBusinessIntentUrl("halo", "081234567890", "ID");
    expect(extractIntentPhone(url)).toBe("6281234567890");
  });

  it("Tanpa countryCode: fallback lama (buang non-digit saja) — backward compatible", () => {
    // Tidak menambah dial → tetap "081234567890" (mungkin bukan wa.me valid,
    // tapi kompatibel dengan caller lama yang sudah menyimpan digit E.164).
    expect(extractPhone(buildWhatsAppUrl("halo", "0812-3456-7890"))).toBe("081234567890");
  });

  it("Nomor kosong / whitespace: tidak menambahkan angka bocor di URL", () => {
    expect(buildWhatsAppUrl("halo", "", "ID")).toBe("https://wa.me/?text=halo");
    expect(buildWhatsAppUrl("halo")).toBe("https://wa.me/?text=halo");
  });
});