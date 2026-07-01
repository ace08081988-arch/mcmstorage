import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { ADMIN_ONLY_URLS } from "@/lib/admin-sidebar-visibility";

/**
 * E2E: non-admin membuka SEMUA route admin (sumber tunggal:
 * `ADMIN_ONLY_URLS` di src/lib/admin-sidebar-visibility.ts) plus
 * halaman alat manajemen admin lain yang tidak masuk sidebar tapi
 * tetap admin-only. Kontrak keras:
 *   - Halaman merender fallback "hanya untuk admin" (bukan konten),
 *   - TIDAK ada satu pun request ke server-fn admin selama load.
 *
 * Auto-skip bila storageState kosong atau user login ternyata admin.
 * Menambah admin route baru cukup dengan menambah ke
 * `ADMIN_ONLY_URLS` atau `EXTRA_ADMIN_ROUTES` — spec otomatis ikut.
 */

const STORAGE = "tests/visual/.auth/user.json";

// Route admin di luar sidebar (mis. tool manajemen langsung via URL).
// Tambah di sini kalau ada route admin baru yang tidak terdaftar di
// ADMIN_ONLY_URLS.
const EXTRA_ADMIN_ROUTES: ReadonlyArray<string> = [
  "/admin/worker-portal",
];

const ADMIN_FN_PATTERNS: ReadonlyArray<RegExp> = [
  /getEmailQueueStatus/i,
  /resendDeviceOtpByMessage/i,
  /listApkReleaseAdmin/i,
  /listApkReleaseAdminPanel/i,
  /listAdminDenialEvents/i,
  /runSecurityScanNow/i,
  /listSecurityFindings/i,
  /adjustApkMinSupported/i,
  /upsertApkReleaseMeta/i,
  /toggleApkReleaseActive/i,
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

const ROUTES: string[] = [...ADMIN_ONLY_URLS, ...EXTRA_ADMIN_ROUTES];

test.describe("non-admin — semua route admin tidak memanggil server-fn admin", () => {
  test.skip(!hasStorageState(), "storageState kosong; setup login dulu.");

  test.beforeEach(async ({ page }) => {
    await page.goto("/chat");
    await expect(
      page.locator('[data-sidebar="menu"] a[href="/chat"]').first(),
    ).toBeVisible({ timeout: 15_000 });
    // Kalau salah satu link admin muncul di sidebar → user test admin,
    // kontrak tidak berlaku.
    let anyAdminLink = 0;
    for (const url of ADMIN_ONLY_URLS) {
      anyAdminLink += await page
        .locator(`[data-sidebar="menu"] a[href="${url}"]`)
        .count();
    }
    test.skip(
      anyAdminLink > 0,
      "user test punya role admin — kontrak non-admin tidak berlaku.",
    );
  });

  for (const route of ROUTES) {
    test(`non-admin buka ${route} → fallback + zero admin server-fn`, async ({
      page,
    }) => {
      const adminHits: string[] = [];
      page.on("request", (req) => {
        const url = req.url();
        if (ADMIN_FN_PATTERNS.some((re) => re.test(url))) adminHits.push(url);
      });

      await page.goto(route);
      // Sidebar render selesai — tanda halaman ter-mount.
      await expect(
        page.locator('[data-sidebar="menu"] a[href="/chat"]').first(),
      ).toBeVisible({ timeout: 15_000 });

      // Halaman harus menampilkan fallback admin-only, bukan konten.
      await expect(
        page.getByText(/Hanya untuk admin|Access Denied|Akses ditolak/i).first(),
      ).toBeVisible({ timeout: 10_000 });

      // Beri waktu tail request (mount effect, refetch awal).
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1_500);

      expect(
        adminHits,
        `Non-admin memicu server-fn admin di ${route}:\n` +
          adminHits.map((u) => `  - ${u}`).join("\n"),
      ).toEqual([]);
    });
  }
});