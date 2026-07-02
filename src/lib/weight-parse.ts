// Utilitas parser satuan berat untuk input teks bebas.
// Aturan konversi (kanonik ke gram):
//   1 kg  = 1000 gr
//   1 ons =  100 gr
//   1 gr  =    1 gr
//   1 mg  = 0.001 gr
//
// Input yang diterima (case-insensitive, spasi bebas, koma/titik desimal):
//   "1 kg", "1kg", "1,5 kg", "0.25 KG"
//   "500 gr", "500g", "500 gram", "500 gr."
//   "2 ons", "2 ONS", "2ons"
//   "500 mg", "500mg"
//   "1000"      → dianggap gram (fallback default)
//   "1.234,5"   → dianggap gram (format id-ID)
// Return null bila input kosong / tidak bisa diparse jadi angka positif.

const UNIT_MULTIPLIER: Record<string, number> = {
  kg: 1000,
  kgs: 1000,
  kilo: 1000,
  kilogram: 1000,
  kilograms: 1000,
  hg: 100,
  ons: 100,
  onz: 100,
  ounce: 100,
  ounces: 100,
  g: 1,
  gr: 1,
  gs: 1,
  gram: 1,
  grams: 1,
  mg: 0.001,
  milligram: 0.001,
  milligrams: 0.001,
};

/** Normalisasi angka Indonesia/US: "1.234,5" → 1234.5, "1,5" → 1.5, "0.5" → 0.5 */
function parseLocalizedNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  // Buang pemisah ribuan yang mustahil merangkap desimal.
  // Deteksi format id-ID: ada koma → koma = desimal, titik = ribuan.
  let normalized: string;
  if (s.includes(",") && s.includes(".")) {
    // Asumsi id-ID: titik ribuan, koma desimal → hapus titik, ganti koma jadi titik.
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    normalized = s.replace(",", ".");
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Pisahkan bagian angka dan satuan dari string mentah.
 * Contoh: "1,5 kg" → { num: "1,5", unit: "kg" }
 *         "500g"  → { num: "500", unit: "g" }
 *         "1000"  → { num: "1000", unit: "" }
 */
function splitNumUnit(raw: string): { num: string; unit: string } {
  const s = raw.trim().replace(/\.$/, "");
  const m = /^([\d.,]+)\s*([a-zA-Z]*)\s*$/.exec(s);
  if (!m) return { num: s, unit: "" };
  return { num: m[1] ?? "", unit: (m[2] ?? "").toLowerCase() };
}

/**
 * Parse input teks bebas menjadi jumlah gram (base unit).
 * @returns gram (bilangan positif) atau `null` jika tidak valid / kosong.
 */
export function parseWeightToGrams(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input : null;
  const raw = String(input).trim();
  if (!raw) return null;
  const { num, unit } = splitNumUnit(raw);
  const n = parseLocalizedNumber(num);
  if (n == null || n < 0) return null;
  if (!unit) return n; // fallback: dianggap gram
  const mult = UNIT_MULTIPLIER[unit];
  if (mult == null) return null; // satuan tidak dikenal
  const grams = n * mult;
  // Bulatkan ke presisi 0.001 g untuk menghindari floating point noise.
  return Math.round(grams * 1000) / 1000;
}

/**
 * Format tampilan gram jadi satuan yang paling ramah.
 *   1500 → "1,5 kg"
 *    300 → "300 gr" (kelipatan 100 di bawah 1000 tetap gr — hindari kejutan)
 *   0.5  → "500 mg"
 *   200  → "200 gr"
 * Set `preferOns` true untuk mengubah kelipatan 100 (100..900) menjadi "X ons".
 */
export function formatGramsSmart(grams: number, opts: { preferOns?: boolean } = {}): string {
  const v = Number(grams);
  if (!Number.isFinite(v)) return "0 gr";
  const abs = Math.abs(v);
  if (abs === 0) return "0 gr";
  if (abs < 1) {
    const mg = Math.round(v * 1000 * 100) / 100;
    return `${mg.toLocaleString("id-ID", { maximumFractionDigits: 2 })} mg`;
  }
  if (abs >= 1000) {
    return `${(v / 1000).toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg`;
  }
  if (opts.preferOns && v % 100 === 0) {
    return `${(v / 100).toLocaleString("id-ID")} ons`;
  }
  return `${v.toLocaleString("id-ID", { maximumFractionDigits: 2 })} gr`;
}

/** Parse untuk field non-berat (mis. pcs/botol): plain angka positif dgn dukungan koma id-ID. */
export function parsePlainQty(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input : null;
  const n = parseLocalizedNumber(String(input));
  if (n == null || n < 0) return null;
  return n;
}