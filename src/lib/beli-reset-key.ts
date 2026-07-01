/**
 * Kunci reset untuk form Catat Pembelian. Setiap kali kunci ini berubah,
 * state form (qty, harga, karton, priceMode) direset agar tidak ada sisa
 * dari pilihan sebelumnya.
 *
 * - Mode "existing": kunci mengikuti item terpilih (itemId).
 * - Mode "new": kunci mengikuti jenis kemasan (packageType), karena tiap
 *   jenis kemasan punya default priceMode / karton yang berbeda.
 */
export function beliResetKey(input: {
  mode: "existing" | "new";
  itemId: string;
  packageType: string;
}): string {
  return input.mode === "existing"
    ? `existing::${input.itemId}`
    : `new::${input.packageType}`;
}