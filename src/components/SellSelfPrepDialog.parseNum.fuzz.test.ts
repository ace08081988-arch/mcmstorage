import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseNum } from "./SellSelfPrepDialog";

/**
 * Property-based / fuzz tests untuk `parseNum`.
 *
 * Invariansi yang di-lock:
 *  1. Output SELALU number murni (tidak NaN, tidak Infinity).
 *  2. Kosong / null / undefined / whitespace-only → 0.
 *  3. Canonical dari NumericTextField ("12345", "0.9", "1500.5") →
 *     `Number(s)` persis — TIDAK boleh dibaca sebagai display id-ID
 *     (bug lama: "0.9" → 9 karena titik dibaca sebagai ribuan).
 *  4. Format display id-ID legacy ("1.500", "1.500,5", "Rp 2.500") →
 *     parse via fallback `parsePaymentAmountInput` (koma = desimal).
 *  5. Angka besar sampai Number.MAX_SAFE_INTEGER tetap konsisten.
 *  6. Idempoten: parseNum(String(parseNum(x))) === parseNum(x)
 *     untuk semua input yang me-return angka berhingga.
 */

// Cast eksplisit — parseNum mentype-kan `string`, tapi kode di lapangan
// kadang meneruskan null/undefined dari state form. Test ini memastikan
// guard di baris `s === "" || s == null` benar-benar menangkap keduanya.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pn = parseNum as unknown as (s: unknown) => number;

describe("parseNum · nilai kosong / null / whitespace → 0", () => {
  it.each([
    ["", 0],
    [null, 0],
    [undefined, 0],
  ])("input %p → %p", (input, expected) => {
    expect(pn(input)).toBe(expected);
  });

  it("whitespace-only strings tidak menghasilkan NaN", () => {
    // Number("   ") === 0 di JS — parseNum warisi perilaku itu (bukan NaN).
    // Yang wajib: tidak pernah NaN dan tidak pernah melempar.
    for (const s of [" ", "  ", "\t", "\n", " \t \n"]) {
      const v = parseNum(s);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(0);
    }
  });
});

describe("parseNum · property: output selalu finite number", () => {
  it("tidak pernah NaN / Infinity untuk sembarang string ASCII", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (s) => {
        const v = parseNum(s);
        return typeof v === "number" && Number.isFinite(v);
      }),
      { numRuns: 500 },
    );
  });

  it("tidak pernah melempar untuk unicode / karakter aneh", () => {
    fc.assert(
      fc.property(fc.fullUnicodeString({ maxLength: 40 }), (s) => {
        const v = parseNum(s);
        return Number.isFinite(v);
      }),
      { numRuns: 300 },
    );
  });
});

describe("parseNum · canonical NumericTextField roundtrip", () => {
  it("integer canonical (tanpa titik) === Number(s)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (n) => {
        const canonical = String(n);
        return parseNum(canonical) === n;
      }),
      { numRuns: 500 },
    );
  });

  it("decimal canonical ('0.9', '1500.5', dst) === Number(s), BUKAN dibaca sebagai ribuan", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 999999 }),
        fc.integer({ min: 1, max: 6 }),
        (intPart, decRaw, decLen) => {
          const decStr = String(decRaw).padStart(decLen, "0").slice(0, decLen);
          const canonical = `${intPart}.${decStr}`;
          const parsed = parseNum(canonical);
          // Kontrak: canonical string dibaca via `Number()`, jadi harus
          // identik dengan Number(canonical) — bukan `intPart * 1000 + ...`.
          return parsed === Number(canonical);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("regresi bug 10× — '0.9' harus 0.9, bukan 9", () => {
    expect(parseNum("0.9")).toBe(0.9);
    expect(parseNum("0.10")).toBe(0.1);
    expect(parseNum("1.5")).toBe(1.5);
    expect(parseNum("1500.5")).toBe(1500.5);
  });
});

describe("parseNum · fallback display id-ID (koma = desimal, titik = ribuan)", () => {
  it("titik ribuan tanpa desimal → integer", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1_000, max: 999_999_999 }), (n) => {
        // Format n dengan titik ribuan id-ID (mis. 1.500.000).
        const display = new Intl.NumberFormat("id-ID").format(n);
        // Display id-ID hanya lolos ke fallback kalau Number(display)
        // gagal (mengandung >1 titik). Untuk n < 1000 Number("500") = 500
        // dan tidak menyentuh fallback — sudah benar.
        // Untuk n ≥ 1.000.000 formatnya "1.000.000" → Number() = NaN →
        // fallback dipanggil dan menghasilkan n.
        if (display.split(".").length > 2) {
          return parseNum(display) === n;
        }
        return true; // skip: kasus 1 titik ambigu (canonical vs display)
      }),
      { numRuns: 200 },
    );
  });

  it("prefix mata uang & spasi dibersihkan di fallback", () => {
    expect(parseNum("Rp 2.500")).toBe(2500);
    expect(parseNum("Rp 1.500.000")).toBe(1_500_000);
    expect(parseNum("Rp 1.500,50")).toBe(1500.5);
  });

  it("koma desimal id-ID di fallback: '1500,50' → 1500.5", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 99 }),
        (intPart, dec) => {
          const decStr = String(dec).padStart(2, "0");
          const display = `${intPart},${decStr}`;
          // Ambigu di canonical (Number("12,50")=NaN), jadi jatuh ke fallback.
          const parsed = parseNum(display);
          const expected = Number(`${intPart}.${decStr}`);
          return Math.abs(parsed - expected) < 1e-9;
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("parseNum · format campuran & noise", () => {
  it("karakter non-numerik acak tidak menghasilkan NaN", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999 }),
        fc.string({ maxLength: 5 }),
        (n, junk) => {
          // Sisipkan noise huruf di tengah — canonical Number() akan gagal,
          // fallback akan strip huruf dan tetap me-return angka finite.
          const messy = `Rp ${junk}${n}${junk}`;
          const v = parseNum(messy);
          return Number.isFinite(v) && v >= 0;
        },
      ),
      { numRuns: 300 },
    );
  });

  it("string hanya tanda / simbol → 0 (bukan NaN)", () => {
    for (const s of ["-", ".", ",", "..", ",,", "Rp", "Rp ", "–"]) {
      const v = parseNum(s);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("parseNum · angka besar", () => {
  it("MAX_SAFE_INTEGER canonical tetap presisi", () => {
    expect(parseNum(String(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("float dekat batas presisi tetap === Number(s)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e15, noNaN: true, noDefaultInfinity: true }),
        (n) => {
          const canonical = String(n);
          // Canonical (dot-decimal) → langsung Number().
          return parseNum(canonical) === Number(canonical);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("parseNum · idempoten", () => {
  it("parseNum(String(parseNum(x))) === parseNum(x)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (s) => {
        const first = parseNum(s);
        const second = parseNum(String(first));
        return first === second;
      }),
      { numRuns: 500 },
    );
  });
});

