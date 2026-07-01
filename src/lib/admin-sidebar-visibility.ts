/**
 * Helper murni untuk menyaring item sidebar berdasarkan status admin.
 * Diekstrak dari `AppSidebar` supaya bisa dipakai di harness E2E
 * `/lovable/visual/admin-visibility` tanpa membawa dependensi router,
 * ikon, atau `useIsAdmin` (yang memanggil Supabase). Kontrak inti:
 *
 *   - Non-admin TIDAK boleh melihat entri untuk URL di `ADMIN_ONLY_URLS`.
 *   - Admin melihat SEMUA entri.
 *
 * URL yang termasuk admin-only WAJIB sama persis dengan yang dipakai
 * `AppSidebar`; kalau ditambah satu route admin baru, tambah di sini
 * agar sidebar dan tes regresi sinkron.
 */
export const ADMIN_ONLY_URLS: ReadonlySet<string> = new Set<string>([
  "/pengaturan-apk",
  "/email-queue",
]);

export function isAdminOnlyUrl(url: string): boolean {
  return ADMIN_ONLY_URLS.has(url);
}

export function filterSidebarItemsForAdmin<T extends { url: string }>(
  items: ReadonlyArray<T>,
  isAdmin: boolean,
): T[] {
  return items.filter((it) => isAdmin || !ADMIN_ONLY_URLS.has(it.url));
}