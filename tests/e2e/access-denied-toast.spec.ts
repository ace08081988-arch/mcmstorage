// README scenario: README.md#access-denied-toast
import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: toast "Perbaiki Akses" untuk error akses-ditolak.
 *
 * Harness: /lovable/visual/access-denied-toast (publik, no-auth).
 *
 * Invariants:
 *   1. Error dengan kode 42501, PGRST301, atau HTTP 401/403 → sonner
 *      menampilkan tombol aksi "Perbaiki Akses".
 *   2. Klik tombol tersebut memanggil `window.location.assign("/profil")`
 *      (di-hook oleh harness dan dicatat pada `#assign-sink`).
 *   3. Error non-akses (mis. 23505 duplicate key) TIDAK menampilkan
 *      tombol "Perbaiki Akses".
 */

const URL = "/lovable/visual/access-denied-toast";

async function clickTriggerAndAssertRedirect(page: Page, testId: string) {
  // Bersihkan sink dulu supaya assertion tidak bocor dari kasus sebelumnya.
  await page.evaluate(() => {
    document
      .getElementById("assign-sink")
      ?.setAttribute("data-last-assign", "");
  });

  await page.getByTestId(testId).click();

  const action = page.getByRole("button", { name: /Perbaiki Akses/i });
  await expect(action).toBeVisible();

  await action.click();

  // `window.location.assign` di-hook oleh harness — target navigasi
  // dicatat di atribut, bukan benar-benar berpindah halaman.
  await expect(page.locator("#assign-sink")).toHaveAttribute(
    "data-last-assign",
    "/profil",
  );

  // Bersihkan toast untuk kasus berikutnya (klik tombol close bila ada,
  // atau tunggu auto-dismiss singkat).
  await page.evaluate(() => {
    document
      .querySelectorAll("[data-sonner-toast]")
      .forEach((el) => el.remove());
  });
}

test.describe("Access denied toast · Perbaiki Akses", () => {
  test("42501 (RLS) → tombol Perbaiki Akses → /profil", async ({ page }) => {
    await page.goto(URL);
    await clickTriggerAndAssertRedirect(page, "btn-42501");
  });

  test("PGRST301 → tombol Perbaiki Akses → /profil", async ({ page }) => {
    await page.goto(URL);
    await clickTriggerAndAssertRedirect(page, "btn-pgrst301");
  });

  test("HTTP 401 → tombol Perbaiki Akses → /profil", async ({ page }) => {
    await page.goto(URL);
    await clickTriggerAndAssertRedirect(page, "btn-401");
  });

  test("HTTP 403 → tombol Perbaiki Akses → /profil", async ({ page }) => {
    await page.goto(URL);
    await clickTriggerAndAssertRedirect(page, "btn-403");
  });

  test("error non-akses (23505) → TIDAK ada tombol Perbaiki Akses", async ({
    page,
  }) => {
    await page.goto(URL);
    await page.getByTestId("btn-generic").click();

    // Toast biasa muncul (pesan sumber kebenaran dari friendly-error).
    await expect(page.getByText(/Data ini sudah ada\./i)).toBeVisible();

    // Tombol aksi TIDAK ada.
    await expect(
      page.getByRole("button", { name: /Perbaiki Akses/i }),
    ).toHaveCount(0);

    // Sink tetap kosong — tidak ada navigasi yang dicoba.
    await expect(page.locator("#assign-sink")).toHaveAttribute(
      "data-last-assign",
      "",
    );
  });
});
