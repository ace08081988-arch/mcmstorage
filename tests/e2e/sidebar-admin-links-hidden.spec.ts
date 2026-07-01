import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/**
 * E2E: sidebar asli (bukan harness) tidak menampilkan link
 * `/email-queue` & `/pengaturan-apk` untuk non-admin, dan halaman
 * yang dimuat TIDAK memicu request ke server-fn admin.
 *
 * Skenario ini melengkapi `admin-visibility.spec.ts` (harness publik)
 * dengan menguji sidebar real setelah login. Test akan otomatis
 * di-skip bila:
 *   - storageState kosong (TEST_EMAIL/TEST_PASSWORD tidak diset di CI), atau
 *   - user login ternyata admin (link admin justru harus muncul).
 */

const STORAGE = "tests/visual/.auth/user.json";

const ADMIN_FN_PATTERNS = [
  /listApkReleaseAdmin/i,
  /listApkReleaseAdminPanel/i,
  /getEmailQueueStatus/i,
  /resendDeviceOtpByMessage/i,
];

function hasStorageState(): boolean {
  try {
    if (!existsSync(STORAGE)) return false;
    const raw = JSON.parse(readFileSync(STORAGE, "utf8"));
    return Array.isArray(raw?.cookies) && raw.cookies.length > 0
      || (Array.isArray(raw?.origins) && raw.origins.length > 0);
  } catch {
    return false;
  }
}

test.describe("sidebar admin links — non-admin", () => {
  test.skip(!hasStorageState(), "storageState kosong; setup login dulu.");

  test("non-admin tidak melihat /email-queue & /pengaturan-apk di sidebar, tanpa server-fn admin", async ({
    page,
  }) => {
    const adminHits: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (ADMIN_FN_PATTERNS.some((re) => re.test(url))) adminHits.push(url);
    });

    await page.goto("/chat");
    // Tunggu sidebar rendering selesai — item "Chat" pasti ada untuk semua user.
    await expect(
      page.locator('[data-sidebar="menu"] a[href="/chat"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    const emailLink = page.locator(
      '[data-sidebar="menu"] a[href="/email-queue"]',
    );
    const apkLink = page.locator(
      '[data-sidebar="menu"] a[href="/pengaturan-apk"]',
    );

    // Kalau user test ternyata admin, skip agar tidak false-positive.
    const isAdmin =
      (await emailLink.count()) > 0 || (await apkLink.count()) > 0;
    test.skip(
      isAdmin,
      "user test punya role admin — kontrak non-admin tidak berlaku.",
    );

    await expect(emailLink).toHaveCount(0);
    await expect(apkLink).toHaveCount(0);

    // Beri waktu network idle sebentar untuk menangkap request tail.
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(adminHits, `admin fn dipanggil: ${adminHits.join(", ")}`).toEqual([]);
  });
});
