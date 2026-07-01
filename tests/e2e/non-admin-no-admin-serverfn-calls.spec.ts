import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/**
 * E2E: non-admin membuka halaman-halaman yang secara historis pernah
 * memicu server-fn admin. Kontrak: TIDAK BOLEH ada satu pun request
 * ke server-fn admin dari client selama pemuatan halaman + settle.
 *
 * Server-fn admin yang di-tracking:
 *   - getEmailQueueStatus
 *   - resendDeviceOtpByMessage
 *   - listApkReleaseAdmin* (Panel/Public varian)
 *   - listAdminDenialEvents
 *   - runSecurityScanNow / listSecurityFindings
 *
 * Halaman yang dikunjungi sebagai non-admin:
 *   - /chat            (default landing, harus tidak eager-load admin)
 *   - /diagnostics     (tautan ke halaman admin ada, tidak boleh eager-fetch)
 *   - /email-queue     (route admin — non-admin harus dapat fallback)
 *   - /pengaturan-apk  (route admin — non-admin harus dapat fallback)
 *   - /admin-denial-log(route admin — non-admin harus dapat fallback)
 *
 * Auto-skip bila storageState kosong atau user login ternyata admin.
 */

const STORAGE = "tests/visual/.auth/user.json";

const ADMIN_FN_PATTERNS: ReadonlyArray<RegExp> = [
  /getEmailQueueStatus/i,
  /resendDeviceOtpByMessage/i,
  /listApkReleaseAdmin/i,
  /listApkReleaseAdminPanel/i,
  /listAdminDenialEvents/i,
  /runSecurityScanNow/i,
  /listSecurityFindings/i,
];

const NON_ADMIN_ROUTES: ReadonlyArray<{ path: string; label: string }> = [
  { path: "/chat", label: "Chat" },
  { path: "/diagnostics", label: "Diagnostik" },
  { path: "/email-queue", label: "Antrian Email (fallback)" },
  { path: "/pengaturan-apk", label: "Rilis APK (fallback)" },
  { path: "/admin-denial-log", label: "Log Penolakan Admin (fallback)" },
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

test.describe("non-admin — tidak ada request ke server-fn admin", () => {
  test.skip(!hasStorageState(), "storageState kosong; setup login dulu.");

  // Cegah false-positive: skip seluruh describe kalau user test admin
  // (sidebar akan menampilkan link admin).
  test.beforeEach(async ({ page }) => {
    await page.goto("/chat");
    await expect(
      page.locator('[data-sidebar="menu"] a[href="/chat"]').first(),
    ).toBeVisible({ timeout: 15_000 });
    const isAdmin =
      (await page
        .locator('[data-sidebar="menu"] a[href="/email-queue"]')
        .count()) > 0 ||
      (await page
        .locator('[data-sidebar="menu"] a[href="/pengaturan-apk"]')
        .count()) > 0 ||
      (await page
        .locator('[data-sidebar="menu"] a[href="/admin-denial-log"]')
        .count()) > 0;
    test.skip(
      isAdmin,
      "user test punya role admin — kontrak non-admin tidak berlaku.",
    );
  });

  for (const route of NON_ADMIN_ROUTES) {
    test(`buka ${route.path} (${route.label}) tidak memanggil server-fn admin`, async ({
      page,
    }) => {
      const adminHits: { url: string; from: string }[] = [];
      page.on("request", (req) => {
        const url = req.url();
        if (ADMIN_FN_PATTERNS.some((re) => re.test(url))) {
          adminHits.push({ url, from: route.path });
        }
      });

      await page.goto(route.path);

      // Tunggu tanda halaman selesai render — cek elemen struktural yang
      // pasti ada di semua route (sidebar).
      await expect(
        page.locator('[data-sidebar="menu"] a[href="/chat"]').first(),
      ).toBeVisible({ timeout: 15_000 });

      // Beri waktu tail request (query yang dijadwalkan setelah mount,
      // refetch interval awal, dsb).
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1_500);

      expect(
        adminHits,
        `Non-admin memicu server-fn admin di ${route.path}:\n` +
          adminHits.map((h) => `  - ${h.url}`).join("\n"),
      ).toEqual([]);
    });
  }
});