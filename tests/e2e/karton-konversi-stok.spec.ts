import { test, expect } from "@playwright/test";

/**
 * E2E: konversi karton di kolom Stok gudang.
 *
 * Harness `/lovable/visual/karton-konversi` merender `fmtItemQty` yang
 * dipakai kartu Stok di /gudang. Test memverifikasi bahwa untuk item
 * botol-per-pcs (GS-like), input `stock_base = 100` otomatis tampil
 * sebagai "100 botol · = 1 karton" — bukan "100 pcs" atau tanpa hint
 * karton. Skenario tambahan menutup batas & sisa.
 */

const URL = "/lovable/visual/karton-konversi";

async function setStock(page: import("@playwright/test").Page, v: string) {
  const input = page.getByTestId("kk-stock-base");
  await input.fill("");
  await input.fill(v);
}

test.describe("/lovable/visual/karton-konversi · kolom Stok gudang", () => {
  test("100 botol → tampil sebagai '100 botol · = 1 karton' (default GS-like)", async ({
    page,
  }) => {
    await page.goto(URL);
    // Default harness: name=GS, package_type=botol, package_size=1, base_unit=pcs
    await setStock(page, "100");
    await expect(page.getByTestId("kk-stok-render")).toHaveText(
      "100 botol · = 1 karton",
    );
  });

  test("250 botol → '250 botol · = 2 karton + 50 botol' (breakdown karton + sisa)", async ({
    page,
  }) => {
    await page.goto(URL);
    await setStock(page, "250");
    await expect(page.getByTestId("kk-stok-render")).toHaveText(
      "250 botol · = 2 karton + 50 botol",
    );
  });

  test("99 botol → '99 botol' tanpa hint karton (< 100)", async ({ page }) => {
    await page.goto(URL);
    await setStock(page, "99");
    await expect(page.getByTestId("kk-stok-render")).toHaveText("99 botol");
  });

  test("500 botol → '5 karton' persis (kelipatan bulat)", async ({ page }) => {
    await page.goto(URL);
    await setStock(page, "500");
    await expect(page.getByTestId("kk-stok-render")).toHaveText(
      "500 botol · = 5 karton",
    );
  });

  test("packageType=gram (item bukan botol) → hint karton TIDAK muncul", async ({
    page,
  }) => {
    await page.goto(URL);
    await page.getByTestId("kk-package-type").selectOption("gram");
    await page.getByTestId("kk-package-size").fill("");
    await page.getByTestId("kk-package-size").fill("500");
    await page.getByTestId("kk-base-unit").selectOption("g");
    await page.getByTestId("kk-name").fill("PASIR");
    await setStock(page, "50000"); // 50 kg
    const rendered = page.getByTestId("kk-stok-render");
    await expect(rendered).not.toContainText("karton");
  });
});