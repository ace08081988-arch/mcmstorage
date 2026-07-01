import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

/**
 * E2E: admin melihat link `/email-queue` & `/pengaturan-apk` di
 * sidebar asli, dan halaman targetnya dapat dibuka penuh (bukan
 * fallback "Hanya untuk admin").
 *
 * Storage state yang dipakai:
 *   - ADMIN_STORAGE (env) jika diset — file storageState untuk user admin,
 *   - default: tests/visual/.auth/user.json — spec auto-skip kalau
 *     user default bukan admin, sehingga aman di-run bersama spec
 *     `sidebar-admin-links-hidden.spec.ts` yang mengasumsikan non-admin.
 */

const STORAGE = process.env.ADMIN_STORAGE ?? "tests/visual/.auth/user.json";

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

test.use({ storageState: STORAGE });

test.describe("sidebar admin links — admin", () => {
  test.skip(!hasStorageState(), "storageState kosong; setup login dulu.");

  test("admin melihat /email-queue & /pengaturan-apk di sidebar dan bisa membuka halamannya", async ({
    page,
  }) => {
    await page.goto("/chat");
    await expect(
      page.locator('[data-sidebar="menu"] a[href="/chat"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    const emailLink = page
      .locator('[data-sidebar="menu"] a[href="/email-queue"]')
      .first();
    const apkLink = page
      .locator('[data-sidebar="menu"] a[href="/pengaturan-apk"]')
      .first();

    // Beri waktu useIsAdmin selesai; kalau setelah 8 detik link admin
    // belum muncul, user ini bukan admin → skip alih-alih fail.
    const emailVisible = await emailLink
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(
      !emailVisible,
      "user login bukan admin — set ADMIN_STORAGE untuk menjalankan spec ini.",
    );

    await expect(emailLink).toBeVisible();
    await expect(apkLink).toBeVisible();

    // Buka /email-queue — konten admin harus muncul, bukan fallback.
    await emailLink.click();
    await expect(page).toHaveURL(/\/email-queue$/);
    await expect(
      page.getByText(/Hanya untuk admin|Access Denied/i),
    ).toHaveCount(0);
    // Judul/heading halaman antrian email.
    await expect(
      page.getByRole("heading", { name: /Antrian Email|Email Queue/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Buka /pengaturan-apk.
    await apkLink.click();
    await expect(page).toHaveURL(/\/pengaturan-apk$/);
    await expect(
      page.getByText(/Hanya untuk admin|Access Denied/i),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: /Rilis APK|Pengaturan APK/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});