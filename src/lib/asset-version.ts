/**
 * Cache-buster versi untuk aset brand statis (kartu OG, favicon, ikon PWA,
 * mstile, manifest).
 *
 * Kenapa perlu: crawler WhatsApp/X/Facebook dan launcher Android/iOS meng-cache
 * gambar berdasarkan URL. Kalau file diganti tapi URL-nya sama, pratinjau lama
 * bisa bertahan berhari-hari. Dengan menempelkan `?v=<versi>`, URL berubah tiap
 * kali aset brand diperbarui sehingga pratinjau ikut segar setelah publish.
 *
 * Cara pakai: setiap kali mengganti file di `public/` (logo, kartu OG, ikon),
 * naikkan `BRAND_ASSET_VERSION` ke tanggal rilis (format YYYYMMDD).
 */
export const BRAND_ASSET_VERSION = "20260808";

/** Buang query/hash yang sudah ada supaya versi tidak bertumpuk. */
export function stripAssetQuery(url: string): string {
  return url.split("#")[0].split("?")[0];
}

/**
 * Tempelkan `?v=<BRAND_ASSET_VERSION>` pada URL aset lokal.
 * URL lintas-origin (mis. foto produk dari storage) dibiarkan apa adanya.
 */
export function withAssetVersion(url: string, version = BRAND_ASSET_VERSION): string {
  if (!url) return url;
  const isLocal = url.startsWith("/") || url.startsWith("https://mcmstorage.app");
  if (!isLocal) return url;
  // Query fungsional (mis. `/api/public/img/og?slug=…&item=…`) dipertahankan;
  // hanya parameter versi lama yang diganti.
  const [withoutHash] = url.split("#");
  const [path, query = ""] = withoutHash.split("?");
  const params = new URLSearchParams(query);
  params.delete("v");
  params.set("v", version);
  return `${path}?${params.toString()}`;
}
