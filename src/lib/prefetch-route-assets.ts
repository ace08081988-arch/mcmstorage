/**
 * Prefetch aset berat khusus per rute.
 *
 * TanStack Router sudah melakukan `preload="intent"` untuk chunk komponen
 * rute, tapi beberapa halaman masih menunggu library besar yang di-import
 * dinamis di dalam komponen. Peta di bawah menjembatani itu: saat pengguna
 * hover/fokus/menyentuh menu, library-nya ikut ditarik lebih awal.
 *
 * Semua fungsi bersifat best-effort — kegagalan diabaikan diam-diam.
 */
import { prefetchJsPDF } from "@/lib/pdf-loader";

const ROUTE_ASSET_PREFETCH: Record<string, () => void> = {
  "/label-preview": prefetchJsPDF,
};

const done = new Set<string>();

export function prefetchRouteAssets(url: string): void {
  const fn = ROUTE_ASSET_PREFETCH[url];
  if (!fn || done.has(url)) return;
  done.add(url);
  try {
    fn();
  } catch {
    /* best-effort */
  }
}

export function hasRouteAssetPrefetch(url: string): boolean {
  return url in ROUTE_ASSET_PREFETCH;
}
