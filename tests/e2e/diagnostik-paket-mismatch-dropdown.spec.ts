import { test, expect } from "@playwright/test";

/**
 * E2E: banner mismatch reaktif terhadap dropdown pasca impor.
 *
 * Setelah payload impor menetapkan state awal, mengubah dropdown `mode`
 * atau `priceMode` HARUS memutakhirkan banner (`diag-mismatch` /
 * `diag-ok`) secara benar — tidak boleh "menyangkut" pada snapshot saat
 * impor. Test ini memverifikasi:
 *
 *   1. Impor payload konsisten → banner OK. Ubah `mode` new → existing
 *      dengan `displayPackageTypeOverride` yang masih "gram" → banner
 *      mismatch MUNCUL dengan bullet spesifik. Kembalikan `mode` ke new
 *      → banner OK kembali.
 *   2. Impor payload dengan override yang mismatch → banner mismatch.
 *      Toggle `priceMode` (package ↔ base) — banner mismatch tetap
 *      terlihat dengan bullet & styling yang sama (priceMode tidak
 *      memengaruhi effPackageType/effBaseUnit). Impor payload benar
 *      (override direset) → banner OK. Toggle `priceMode` sekali lagi
 *      → banner tetap OK.
 */

const URL = "/diagnostik/paket";

const MISMATCH_CLASS_TOKENS = [
  /(^|\s)border-red-500\/60(\s|$)/,
  /(^|\s)bg-red-500\/10(\s|$)/,
  /(^|\s)text-red-700(\s|$)/,
];
const OK_CLASS_TOKENS = [
  /(^|\s)border-emerald-500\/50(\s|$)/,
  /(^|\s)bg-emerald-500\/10(\s|$)/,
  /(^|\s)text-emerald-700(\s|$)/,
];

async function expectAllClasses(
  locator: import("@playwright/test").Locator,
  patterns: RegExp[],
) {
  for (const p of patterns) await expect(locator).toHaveClass(p);
}

async function applyPayload(
  page: import("@playwright/test").Page,
  payload: unknown,
) {
  const input = page.getByTestId("diag-payload-input");
  await input.fill("");
  await input.fill(JSON.stringify(payload));
  await page.getByTestId("diag-payload-apply").click();
  await expect(page.getByTestId("diag-payload-error")).toHaveCount(0);
}

test.describe("/diagnostik/paket · banner reaktif terhadap dropdown", () => {
  test("ubah dropdown mode pasca impor → banner mismatch muncul, lalu hilang saat mode dikembalikan", async ({
    page,
  }) => {
    await page.goto(URL);

    // Impor payload konsisten (tanpa override).
    await applyPayload(page, {
      mode: "new",
      packageType: "gram",
      packageSize: "500",
      packageQty: "2",
      priceMode: "package",
      pricePerPackage: "10000",
      displayBaseUnitOverride: null,
      displayPackageTypeOverride: "gram",
    });

    // Baseline: OK (display "gram" = eff "gram", displayBaseUnit "g" = eff "g").
    const ok = page.getByTestId("diag-ok");
    await expect(ok).toBeVisible();
    await expect(ok).toContainText("✓");
    await expectAllClasses(ok, OK_CLASS_TOKENS);
    await expect(page.getByTestId("diag-mismatch")).toHaveCount(0);

    // Ubah mode dropdown → "existing". selectedItem default = botol/600/pcs
    // sehingga effPackageType flip ke "botol", TAPI override display masih
    // "gram" → banner mismatch harus muncul.
    await page.getByTestId("diag-input-mode").selectOption("existing");

    const mismatch = page.getByTestId("diag-mismatch");
    await expect(mismatch).toBeVisible();
    await expect(page.getByTestId("diag-ok")).toHaveCount(0);
    await expect(mismatch.locator("h2")).toHaveText("⚠ Mismatch terdeteksi");
    await expectAllClasses(mismatch, MISMATCH_CLASS_TOKENS);

    const bullets = mismatch.locator("li");
    await expect(bullets).toHaveCount(1);
    await expect(bullets).toHaveText([
      "displayPackageType (gram) ≠ effPackageType (botol)",
    ]);
    await expect(page.getByTestId("diag-display-package-type")).toHaveText(
      "gram",
    );
    await expect(page.getByTestId("diag-eff-package-type")).toHaveText("botol");

    // Kembalikan mode ke "new" → banner OK kembali.
    await page.getByTestId("diag-input-mode").selectOption("new");
    await expect(page.getByTestId("diag-mismatch")).toHaveCount(0);
    const ok2 = page.getByTestId("diag-ok");
    await expect(ok2).toBeVisible();
    await expectAllClasses(ok2, OK_CLASS_TOKENS);
  });

  test("ubah dropdown priceMode pasca impor → banner tetap sinkron dengan state saat ini", async ({
    page,
  }) => {
    await page.goto(URL);

    // Impor payload dengan override mismatch.
    await applyPayload(page, {
      mode: "new",
      packageType: "gram",
      packageSize: "500",
      packageQty: "2",
      priceMode: "package",
      pricePerPackage: "10000",
      pricePerBase: "20",
      displayBaseUnitOverride: "pcs",
    });

    const mismatch = page.getByTestId("diag-mismatch");
    await expect(mismatch).toBeVisible();
    await expectAllClasses(mismatch, MISMATCH_CLASS_TOKENS);
    const bulletsBefore = mismatch.locator("li");
    await expect(bulletsBefore).toHaveText([
      "displayBaseUnit (pcs) ≠ effBaseUnit (g)",
      "mode=new: displayBaseUnit (pcs) tidak sesuai defaultBaseUnit(gram)=g",
    ]);

    // Toggle priceMode → base. priceMode tidak memengaruhi
    // effPackageType/effBaseUnit, jadi banner mismatch harus BERTAHAN
    // dengan bullet & styling sama.
    await page.getByTestId("diag-input-price-mode").selectOption("base");
    await expect(page.getByTestId("diag-mismatch")).toBeVisible();
    await expect(page.getByTestId("diag-ok")).toHaveCount(0);
    await expectAllClasses(
      page.getByTestId("diag-mismatch"),
      MISMATCH_CLASS_TOKENS,
    );
    await expect(page.getByTestId("diag-mismatch").locator("li")).toHaveText([
      "displayBaseUnit (pcs) ≠ effBaseUnit (g)",
      "mode=new: displayBaseUnit (pcs) tidak sesuai defaultBaseUnit(gram)=g",
    ]);

    // Kembalikan priceMode → package: masih mismatch.
    await page.getByTestId("diag-input-price-mode").selectOption("package");
    await expect(page.getByTestId("diag-mismatch")).toBeVisible();
    await expect(page.getByTestId("diag-ok")).toHaveCount(0);

    // Impor payload benar (override direset) → banner OK.
    await applyPayload(page, {
      mode: "new",
      packageType: "gram",
      packageSize: "500",
      packageQty: "2",
      priceMode: "package",
      pricePerPackage: "10000",
      pricePerBase: "20",
      displayBaseUnitOverride: null,
      displayPackageTypeOverride: null,
    });
    const ok = page.getByTestId("diag-ok");
    await expect(ok).toBeVisible();
    await expect(page.getByTestId("diag-mismatch")).toHaveCount(0);
    await expectAllClasses(ok, OK_CLASS_TOKENS);

    // Toggle priceMode lagi → banner tetap OK (tidak spurious flip).
    await page.getByTestId("diag-input-price-mode").selectOption("base");
    await expect(page.getByTestId("diag-ok")).toBeVisible();
    await expect(page.getByTestId("diag-mismatch")).toHaveCount(0);
    await expectAllClasses(page.getByTestId("diag-ok"), OK_CLASS_TOKENS);
  });
});