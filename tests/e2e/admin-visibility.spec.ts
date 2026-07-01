import { test, expect } from "@playwright/test";

/**
 * E2E: kontrak visibilitas menu admin di sidebar + halaman admin.
 *
 * Harness publik `/lovable/visual/admin-visibility` merender daftar item
 * sidebar yang sudah disaring `filterSidebarItemsForAdmin` dan hasil
 * klasifikasi `classifyApkAdminView` — tanpa memanggil server-fn admin
 * atau login. Tes ini memverifikasi:
 *
 *   1. Non-admin: entri `/pengaturan-apk` & `/email-queue` TIDAK muncul.
 *   2. Admin:     kedua entri tersebut MUNCUL (kontrol regresi).
 *   3. Halaman APK jatuh ke tampilan "notice" untuk non-admin dan
 *      "content" untuk admin.
 *   4. Halaman ini TIDAK memicu request ke server-fn admin
 *      (`listApkReleaseAdmin*`, `getEmailQueueStatus`). Ini bukti
 *      bahwa saat user non-admin melihat sidebar, tidak ada endpoint
 *      admin yang di-hit sama sekali.
 */

const ADMIN_FN_PATTERNS = [
  /listApkReleaseAdmin/i,
  /listApkReleaseAdminPanel/i,
  /getEmailQueueStatus/i,
];

function isAdminFnRequest(url: string): boolean {
  return ADMIN_FN_PATTERNS.some((re) => re.test(url));
}

test.describe("admin visibility — sidebar + fallback", () => {
  test("non-admin: item admin disembunyikan & tidak ada request server-fn admin", async ({
    page,
  }) => {
    const adminHits: string[] = [];
    page.on("request", (req) => {
      if (isAdminFnRequest(req.url())) adminHits.push(req.url());
    });

    await page.goto("/lovable/visual/admin-visibility?admin=false");

    await expect(page.getByTestId("mode")).toHaveText("non-admin");
    await expect(page.getByTestId("admin-only-count")).toHaveText("2");

    // Item non-admin tetap terlihat (kontrol positif).
    await expect(page.getByTestId("admin-item-visible-root")).toBeVisible();
    await expect(page.getByTestId("admin-item-visible-chat")).toBeVisible();

    // Item admin-only WAJIB hilang dari daftar terlihat.
    await expect(
      page.getByTestId("admin-item-visible-pengaturan-apk"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("admin-item-visible-email-queue"),
    ).toHaveCount(0);

    // Sebaliknya, mereka harus tercatat di kolom "disembunyikan".
    await expect(
      page.getByTestId("admin-item-hidden-pengaturan-apk"),
    ).toBeVisible();
    await expect(
      page.getByTestId("admin-item-hidden-email-queue"),
    ).toBeVisible();

    // Halaman APK jatuh ke banner "Hanya admin".
    await expect(page.getByTestId("apk-view-kind")).toHaveText("notice");

    // Tidak ada request ke server-fn admin.
    expect(adminHits).toEqual([]);
  });

  test("admin: item admin muncul & apk view = content", async ({ page }) => {
    const adminHits: string[] = [];
    page.on("request", (req) => {
      if (isAdminFnRequest(req.url())) adminHits.push(req.url());
    });

    await page.goto("/lovable/visual/admin-visibility?admin=true");

    await expect(page.getByTestId("mode")).toHaveText("admin");
    await expect(
      page.getByTestId("admin-item-visible-pengaturan-apk"),
    ).toBeVisible();
    await expect(
      page.getByTestId("admin-item-visible-email-queue"),
    ).toBeVisible();
    await expect(page.getByTestId("admin-item-hidden-empty")).toBeVisible();
    await expect(page.getByTestId("apk-view-kind")).toHaveText("content");

    // Harness sendiri tidak memanggil server-fn admin.
    expect(adminHits).toEqual([]);
  });
});