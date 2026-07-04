/** Display the human unit label for an ecer/request line.
 *  Special case: products named "GS" are always counted as "botol",
 *  regardless of the stored unit label (which may be "gram").
 */
export function displayUnit(productName: string | null | undefined, unitLabel: string | null | undefined): string {
  const name = (productName ?? "").trim().toLowerCase();
  if (name === "gs") return "botol";
  return unitLabel ?? "";
}

/**
 * Nama satuan dasar yang layak ditampilkan ke user.
 *
 * Aturan tunggal untuk seluruh aplikasi: produk botol yang dihitung per-pcs
 * (mis. GS: `package_type='botol'`, `base_unit='pcs'`, `package_size=1`)
 * sebenarnya "counted by botol", jadi label 'pcs' membingungkan. Kembalikan
 * 'botol' di kasus tersebut; kembalikan `baseUnit` apa adanya untuk yang lain.
 */
export function humanBaseUnit(
  packageType: string | null | undefined,
  baseUnit: string | null | undefined,
): string {
  const pt = (packageType ?? "").trim().toLowerCase();
  const bu = (baseUnit ?? "").trim().toLowerCase();
  if (pt === "botol" && bu === "pcs") return "botol";
  return baseUnit ?? "";
}

/**
 * Grup sinonim satuan yang secara semantik identik. Dipakai untuk mendeteksi
 * kasus seperti `package_type="gram"` + `base_unit="g"` (1 gram = 1 g), di mana
 * tombol/label "per package" hanya menduplikasi satuan dasar.
 */
const UNIT_SYNONYMS: readonly (readonly string[])[] = [
  ["g", "gr", "gram", "grams"],
  ["kg", "kilo", "kilogram", "kilograms"],
  ["pcs", "pc", "piece", "pieces", "buah", "biji"],
  ["botol", "bottle"],
  ["karton", "carton", "dus"],
  ["sachet", "sachets"],
  ["ons", "hg"],
];

function canonUnit(s: string | null | undefined): string {
  const v = (s ?? "").trim().toLowerCase();
  if (!v) return "";
  for (const group of UNIT_SYNONYMS) {
    if (group.includes(v)) return group[0]!;
  }
  return v;
}

/** True jika kedua label satuan menunjuk ke satuan yang secara semantik sama. */
export function isSameUnitLabel(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ca = canonUnit(a);
  const cb = canonUnit(b);
  if (!ca || !cb) return false;
  return ca === cb;
}