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