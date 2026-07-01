/**
 * Harness publik (no-auth, no-network) untuk memverifikasi kontrak
 * visibilitas menu admin di sidebar + fallback halaman admin.
 *
 * URL: /lovable/visual/admin-visibility?admin=false|true
 *
 * Yang diuji:
 *   1. `filterSidebarItemsForAdmin` menyaring URL admin-only untuk
 *      non-admin (`/pengaturan-apk`, `/email-queue`) — E2E memastikan
 *      testid `admin-item-visible-{slug}` TIDAK ada untuk non-admin.
 *   2. Klasifikasi tampilan halaman APK (`classifyApkAdminView`)
 *      jatuh ke "notice" (banner Hanya admin) ketika server-fn
 *      mengembalikan payload `isAdmin:false` — TIDAK crash.
 *   3. Halaman ini SAMA SEKALI tidak memanggil server-fn admin.
 *      E2E menyalakan network sniffer untuk memastikan itu.
 *
 * Route ini `noindex,nofollow` dan tidak dilink dari mana pun.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  ADMIN_ONLY_URLS,
  filterSidebarItemsForAdmin,
} from "@/lib/admin-sidebar-visibility";
import { classifyApkAdminView } from "@/lib/apk-admin-visibility";

type Search = { admin: boolean };

export const Route = createFileRoute("/lovable/visual/admin-visibility")({
  head: () => ({
    meta: [
      { title: "Harness · Admin visibility" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  validateSearch: (raw: Record<string, unknown>): Search => {
    const v = raw.admin;
    // Terima "true"/"false" (string) & boolean (hasil default JSON parser
    // TanStack Router). Semua nilai lain → non-admin.
    return { admin: v === true || v === "true" };
  },
  component: AdminVisibilityHarness,
});

// Snapshot statis daftar item sidebar — cukup untuk menguji filter tanpa
// menarik seluruh dependensi `AppSidebar` (router, ikon, Supabase).
// Kalau item admin baru ditambah, tambah di sini + di `ADMIN_ONLY_URLS`.
const ITEMS: ReadonlyArray<{ url: string; title: string }> = [
  { url: "/", title: "Beranda" },
  { url: "/gudang", title: "Gudang & Supplier" },
  { url: "/chat", title: "Chat" },
  { url: "/hutang-piutang", title: "Hutang & Piutang" },
  { url: "/profil", title: "Profil Akun" },
  { url: "/audit", title: "Audit Rute" },
  { url: "/diagnostics", title: "Diagnostik" },
  { url: "/email-queue", title: "Antrian Email" },
  { url: "/pengaturan-apk", title: "Rilis APK" },
];

function slug(url: string): string {
  return url === "/" ? "root" : url.replace(/^\//, "").replace(/\//g, "-");
}

function AdminVisibilityHarness() {
  const search = Route.useSearch();
  const isAdmin = search.admin;

  const visible = filterSidebarItemsForAdmin(ITEMS, isAdmin);
  const visibleUrls = new Set(visible.map((i) => i.url));
  const hidden = ITEMS.filter((i) => !visibleUrls.has(i.url));

  // Simulasikan payload server-fn admin untuk non-admin — TIDAK memanggil
  // `listApkReleaseAdminPanel` (itu memerlukan auth). Ini bukti bahwa
  // route ini bisa merender fallback "Hanya admin" tanpa menyentuh
  // server fn admin sama sekali.
  const apkView = classifyApkAdminView({
    isCheckingAdmin: false,
    isAdmin,
    isLoadingApk: false,
    isError: false,
    data: {
      isAdmin,
      entries: [],
      minSupported: { storage: null, chat: null },
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 text-sm">
      <header className="space-y-1">
        <h1 className="text-base font-semibold">Harness · Admin visibility</h1>
        <p className="text-muted-foreground">
          Kontrak sidebar admin-only + fallback halaman APK, tanpa auth &
          tanpa memanggil server-fn admin.
        </p>
        <p data-testid="mode">{isAdmin ? "admin" : "non-admin"}</p>
        <p data-testid="admin-only-count">{ADMIN_ONLY_URLS.size}</p>
      </header>

      <section className="space-y-2">
        <h2 className="font-medium">Item terlihat</h2>
        <ul className="rounded-md border border-border">
          {visible.map((it) => (
            <li
              key={it.url}
              data-testid={`admin-item-visible-${slug(it.url)}`}
              data-url={it.url}
              className="border-b border-border/60 px-3 py-2 last:border-b-0"
            >
              {it.title}
              <span className="ml-2 text-xs text-muted-foreground">
                {it.url}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Item disembunyikan</h2>
        <ul className="rounded-md border border-border">
          {hidden.length === 0 ? (
            <li
              data-testid="admin-item-hidden-empty"
              className="px-3 py-2 text-muted-foreground"
            >
              (tidak ada — admin melihat semua)
            </li>
          ) : (
            hidden.map((it) => (
              <li
                key={it.url}
                data-testid={`admin-item-hidden-${slug(it.url)}`}
                data-url={it.url}
                className="border-b border-border/60 px-3 py-2 last:border-b-0"
              >
                {it.title}
                <span className="ml-2 text-xs text-muted-foreground">
                  {it.url}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Fallback halaman APK</h2>
        <div
          data-testid="apk-view-kind"
          className="rounded-md border border-border px-3 py-2"
        >
          {apkView}
        </div>
      </section>
    </div>
  );
}