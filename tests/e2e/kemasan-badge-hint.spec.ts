import { test, expect } from "@playwright/test";

/**
 * E2E: hint teks (popover rumus) & badge breakdown konversi kemasan di
 * /gudang. Harness publik `/lovable/visual/kemasan-badge` merender
 * <KemasanRumusPopover> + <KemasanKonversiBadge> + fmtItemQty(qty_base)
 * memakai payload item yang sama (package_type, package_size, base_unit).
 *
 * Test menegakkan:
 *   1. Popover memuat kalimat "1 karton = 100 botol" untuk item botol.
 *   2. Badge mode karton (N=2) menampilkan "2 karton = 200 botol".
 *   3. Kolom Stok fmtItemQty pada qty_base=200 konsisten dengan badge —
 *      yaitu memuat "200 botol" dan "2 karton" bersamaan.
 *   4. Ketika package_type diganti ke gram (bukan botol), hint "karton"
 *      TIDAK muncul di popover dan badge tidak menampilkan karton.
 */

const URL = "/lovable/visual/kemasan-badge";

async function setInput(
  page: import("@playwright/test").Page,
  testId: string,
  v: string,
) {
  const el = page.getByTestId(testId);
  await el.fill("");
  await el.fill(v);
}

test.describe("/lovable/visual/kemasan-badge · hint & badge breakdown", () => {
  test("popover botol memuat 'Rumus konversi kemasan' + '1 karton = 100 botol'", async ({
    page,
  }) => {
    await page.goto(URL);
    // Default: packageType=botol, packageSize=1, baseUnit=pcs, mode=karton, qty=1
    await page.getByTestId("kb-rumus-trigger").hover();
    const content = page.getByTestId("kemasan-rumus-content");
    await expect(content).toBeVisible();
    await expect(content).toContainText("Rumus konversi kemasan");
    await expect(content).toContainText("1 karton =");
    await expect(content).toContainText("100");
    await expect(content).toContainText("botol");
  });

  test("badge mode=karton (qty=2, botol) → '2 karton = 200 botol'", async ({
    page,
  }) => {
    await page.goto(URL);
    await setInput(page, "kb-qty", "2");
    await expect(page.getByTestId("kb-badge")).toHaveText("2 karton = 200 botol");
  });

  test("badge karton (qty=2) konsisten dengan fmtItemQty(200 botol) di kolom Stok", async ({
    page,
  }) => {
    await page.goto(URL);
    await setInput(page, "kb-qty", "2");
    // Badge: "2 karton = 200 botol"
    await expect(page.getByTestId("kb-badge")).toContainText("200 botol");
    // Kolom Stok fmtItemQty(200, botol/pcs/1): "200 botol · = 2 karton"
    const stok = page.getByTestId("kb-stok-render");
    await expect(stok).toContainText("200 botol");
    await expect(stok).toContainText("2 karton");
  });

  test("mode=base (qty=250, botol) → badge '250 botol = 2 karton + 50 botol' & stok konsisten", async ({
    page,
  }) => {
    await page.goto(URL);
    await page.getByTestId("kb-mode").selectOption("base");
    await setInput(page, "kb-qty", "250");
    await expect(page.getByTestId("kb-badge")).toHaveText(
      "250 botol = 2 karton + 50 botol",
    );
    // fmtItemQty(250 botol) juga menampilkan breakdown karton + sisa.
    await expect(page.getByTestId("kb-stok-render")).toHaveText(
      "250 botol · = 2 karton + 50 botol",
    );
  });

  test("packageType=gram → popover TIDAK menyebut 'karton', badge tidak render", async ({
    page,
  }) => {
    await page.goto(URL);
    await page.getByTestId("kb-package-type").selectOption("gram");
    await setInput(page, "kb-package-size", "500");
    await page.getByTestId("kb-base-unit").selectOption("g");
    await page.getByTestId("kb-mode").selectOption("package");
    await setInput(page, "kb-qty", "2");

    await page.getByTestId("kb-rumus-trigger").hover();
    const content = page.getByTestId("kemasan-rumus-content");
    await expect(content).toBeVisible();
    await expect(content).not.toContainText("karton");
    await expect(content).toContainText("1 gram =");
    await expect(content).toContainText("500");

    // Badge mode=package untuk gram: "2 gram = 1.000 g"
    await expect(page.getByTestId("kb-badge")).toContainText("2 gram");
    await expect(page.getByTestId("kb-badge")).not.toContainText("karton");
    // fmtItemQty(1000 g) — konsisten (tidak ada hint karton).
    await expect(page.getByTestId("kb-stok-render")).not.toContainText("karton");
  });
});