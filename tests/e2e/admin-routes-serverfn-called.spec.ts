import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/**
 * E2E: user admin membuka setiap route admin dan MEMANGGIL server-fn
 * yang sesuai. Kontrak positif — lawan dari
 * `non-admin-all-admin-routes-no-serverfn.spec.ts` yang menegakkan
 * kontrak negatif (non-admin ⇒ nol call).
 *
 * Menambah route admin baru: tambahkan entri di `ADMIN_ROUTE_FN_MAP`.
 * Auto-skip bila storageState kosong atau user login ternyata BUKAN
 * admin (link admin tidak muncul di sidebar).
 */

const STORAGE = "tests/visual/.auth/user.json";

// URL → daftar nama server-fn yang WAJIB muncul di request log saat
// route dibuka (subset match, cukup salah satu terlihat).
// Fn name di-embed oleh TanStack Start di request URL/serialized RPC.
const ADMIN_ROUTE_FN_MAP: ReadonlyArray<{
  route: string;
  fnPatterns: ReadonlyArray<RegExp>;
}> = [
  {
    route: "/pengaturan-apk",
    fnPatterns: [/listApkReleaseAdminPanel/i],
  },
  {
    route: "/email-queue",
    fnPatterns: [/getEmailQueueStatus/i],
  },
  {
    route: "/admin-denial-log",
    fnPatterns: [/listAdminDenialEvents/i],
  },
];

function hasStorageState(): boolean {
  try {
    if (!existsSync(STORAGE)) return false;
    const raw = JSON.parse(readFileSync(STORAGE, "utf8"));
    return (Array.isArray(raw?.cookies) && raw.cookies.length > 0)
      || (Array.isArray(raw?.origins) && raw.origins.length > 0);
  } catch {
    return false;
  }
}

test.describe("admin — route admin memicu server-fn admin yang sesuai", () => {
  test.skip(!hasStorageState(), "storageState kosong; setup login dulu.");

  test.beforeEach(async ({ page }) => {
    await page.goto("/chat");
    await expect(
      page.locator('[data-sidebar="menu"] a[href="/chat"]').first(),
    ).toBeVisible({ timeout: 15_000 });
    // Kalau link admin TIDAK terlihat di sidebar → user bukan admin;
    // kontrak positif tidak relevan.
    const adminLinkCount = await page
      .locator('[data-sidebar="menu"] a[href="/pengaturan-apk"]')
      .count();
    test.skip(
      adminLinkCount === 0,
      "user test bukan admin — kontrak admin tidak berlaku.",
    );
  });

  for (const { route, fnPatterns } of ADMIN_ROUTE_FN_MAP) {
    test(`admin buka ${route} → server-fn dipanggil`, async ({ page }) => {
      const hits: string[] = [];
      page.on("request", (req) => {
        const url = req.url();
        if (fnPatterns.some((re) => re.test(url))) hits.push(url);
      });

      await page.goto(route);
      // Tanda halaman ter-mount.
      await expect(
        page.locator('[data-sidebar="menu"] a[href="/chat"]').first(),
      ).toBeVisible({ timeout: 15_000 });

      // Halaman TIDAK boleh menampilkan fallback admin-only.
      await expect(
        page.getByText(/Hanya untuk admin|Hanya admin|Akses ditolak/i),
      ).toHaveCount(0);

      // Tunggu tail request awal (loader + refetch mount effect).
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1_500);

      expect(
        hits.length,
        `Admin buka ${route} tapi TIDAK ada request ke ${fnPatterns
          .map((r) => r.source)
          .join(", ")}. URL tertangkap:\n` +
          (hits.length ? hits.map((u) => `  - ${u}`).join("\n") : "  (kosong)"),
      ).toBeGreaterThan(0);
    });
  }
});