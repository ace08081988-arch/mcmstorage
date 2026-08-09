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
  "/chat-audit",
  "/hubungkan-agen",
]);

export function isHiddenMenuUrl(url: string): boolean {
  return HIDDEN_MENU_URLS.has(url);
}

/** Buang entri menu yang menunjuk ke rute teknis. */
export function filterHiddenMenuItems<T extends { url: string }>(
  items: ReadonlyArray<T>,
): T[] {
  return items.filter((it) => !HIDDEN_MENU_URLS.has(it.url));
}
