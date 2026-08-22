/**
 * Rute teknis (diagnostik, debug/dev, dan alat internal) yang TIDAK boleh
 * muncul di navigasi mana pun — sidebar maupun hub Pengaturan — supaya
 * aplikasi terasa profesional bagi pengguna sehari-hari.
 *
 * Catatan penting: rute-nya TIDAK dihapus. Semua halaman di bawah ini tetap
 * bisa dibuka lewat URL langsung (deep link) untuk keperluan debugging;
 * yang hilang hanya entri menunya.
 */
export const HIDDEN_MENU_URLS: ReadonlySet<string> = new Set<string>([
  // Diagnostik & performa
  "/diagnostics",
  "/diagnostik-list",
  "/diagnostik-viewport",
  "/metrik-query",
  "/perf",
  "/audit",
  "/pengaturan-scroll-guard",
  // Debug & dev
  "/debug/selector",
  "/dev/press-audit-codes",
  "/dev/press-audit-demo",
  "/label-preview",
  "/pratinjau-tema",
  // Admin internal
  "/admin/dependensi",
  "/admin/web-vitals",
  "/admin/rekonsiliasi",
  "/chat-audit",
  "/hubungkan-agen",
]);

export function isHiddenMenuUrl(url: string): boolean {
  return HIDDEN_MENU_URLS.has(url);
}

/**
 * Dulu dipakai untuk menyembunyikan halaman setelan dari sidebar. Atas
 * permintaan pengguna, semua menu pilihan itu DIKEMBALIKAN ke sidebar,
 * jadi daftar ini sengaja dibiarkan kosong (jangan diisi lagi tanpa
 * permintaan eksplisit).
 */
export const SIDEBAR_ONLY_HIDDEN_URLS: ReadonlySet<string> = new Set<string>([]);


/** Buang entri menu yang tersembunyi khusus untuk sidebar. */
export function filterSidebarMenuItems<T extends { url: string }>(
  items: ReadonlyArray<T>,
): T[] {
  return filterHiddenMenuItems(items).filter(
    (it) => !SIDEBAR_ONLY_HIDDEN_URLS.has(it.url),
  );
}

/**
 * Prefiks rute yang bukan halaman produk sama sekali: harness pengujian
 * visual. Di dev/CI harness harus tetap bisa dibuka apa adanya (dipakai
 * Playwright), jadi gerbangnya hanya aktif pada build produksi.
 */
const TECHNICAL_URL_PREFIXES: readonly string[] = ["/lovable/"];

/**
 * Dipakai gerbang rute teknis (bukan penyaring menu): mencakup daftar
 * tersembunyi + prefiks harness yang hanya digerbang di produksi.
 */
export function isTechnicalRouteUrl(url: string): boolean {
  if (HIDDEN_MENU_URLS.has(url)) return true;
  if (!import.meta.env.PROD) return false;
  return TECHNICAL_URL_PREFIXES.some((p) => url.startsWith(p));
}

/** Buang entri menu yang menunjuk ke rute teknis. */
export function filterHiddenMenuItems<T extends { url: string }>(
  items: ReadonlyArray<T>,
): T[] {
  return items.filter((it) => !HIDDEN_MENU_URLS.has(it.url));
}
