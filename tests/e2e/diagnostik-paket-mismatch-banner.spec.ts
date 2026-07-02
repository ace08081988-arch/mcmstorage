import { test, expect } from "@playwright/test";

/**
 * E2E: banner mismatch pada /diagnostik/paket
 *
 * Halaman diagnostik membandingkan `display*` (yang dipakai untuk merender
 * label) terhadap `derived.eff*` (hasil {@link computeBeliDerived}). Bila
 * keduanya berbeda, banner `diag-mismatch` muncul; bila sinkron, banner
 * `diag-ok` yang muncul.
 *
 * Untuk mensimulasikan bug "render stale" (label tidak ikut berubah
 * meskipun state derived sudah benar), payload menerima dua field khusus:
 *   - `displayBaseUnitOverride`      : "g" | "pcs" | null
 *   - `displayPackageTypeOverride`   : "gram" | "botol" | "pcs" | "sachet" | null
 *
 * Test ini memverifikasi:
 *   1. Payload dengan override yang menyimpang → banner mismatch muncul,
 *      pesan menyebut field yang menyimpang.
 *   2. Payload benar (override direset ke null) → banner mismatch hilang,
 *      banner OK yang muncul.
 */

const URL = "/diagnostik/paket";

async function applyPayload(page: import("@playwright/test").Page, payload: unknown) {
  const input = page.getByTestId("diag-payload-input");
  await input.fill("");
  await input.fill(JSON.stringify(payload));
  await page.getByTestId("diag-payload-apply").click();
  await expect(page.getByTestId("diag-payload-error")).toHaveCount(0);
}

test.describe("/diagnostik/paket · banner mismatch", () => {
  test("displayBaseUnitOverride menyimpang → banner muncul, pesan spesifik", async ({
    page,
  }) => {
    await page.goto(URL);

    // Baseline: state default konsisten.
    await expect(page.getByTestId("diag-ok")).toBeVisible();
    await expect(page.getByTestId("diag-mismatch")).toHaveCount(0);

    // gram → effBaseUnit "g", tapi display dipaksa "pcs".
    await applyPayload(page, {
      mode: "new",
      packageType: "gram",
      packageSize: "500",
      packageQty: "2",
      priceMode: "package",
      pricePerPackage: "10000",
      displayBaseUnitOverride: "pcs",
    });

    // Banner mismatch tampil, banner OK tidak.
    const mismatch = page.getByTestId("diag-mismatch");
    await expect(mismatch).toBeVisible();
    await expect(page.getByTestId("diag-ok")).toHaveCount(0);
    await expect(mismatch).toContainText("displayBaseUnit");
    await expect(mismatch).toContainText("effBaseUnit");

    // Display & label mengikuti override (bukti label benar-benar stale).
    await expect(page.getByTestId("diag-display-base-unit")).toHaveText("pcs");
    await expect(page.getByTestId("diag-eff-base-unit")).toHaveText("g");
    await expect(page.getByTestId("diag-label-isi")).toHaveText(
      "“Isi / kemasan (pcs)”",
    );
  });

  test("displayPackageTypeOverride menyimpang → banner muncul", async ({
    page,
  }) => {
    await page.goto(URL);

    await applyPayload(page, {
      mode: "new",
      packageType: "gram",
      packageSize: "500",
      packageQty: "1",
      priceMode: "package",
      pricePerPackage: "10000",
      displayPackageTypeOverride: "botol",
    });

    const mismatch = page.getByTestId("diag-mismatch");
    await expect(mismatch).toBeVisible();
    await expect(mismatch).toContainText("displayPackageType");
    await expect(mismatch).toContainText("effPackageType");
    await expect(page.getByTestId("diag-display-package-type")).toHaveText(
      "botol",
    );
    await expect(page.getByTestId("diag-eff-package-type")).toHaveText("gram");
  });

  test("impor payload benar setelah override → banner mismatch hilang", async ({
    page,
  }) => {
    await page.goto(URL);

    // 1) Picu mismatch.
    await applyPayload(page, {
      mode: "new",
      packageType: "gram",
      packageSize: "500",
      packageQty: "2",
      priceMode: "package",
      pricePerPackage: "10000",
      displayBaseUnitOverride: "pcs",
      displayPackageTypeOverride: "botol",
    });
    await expect(page.getByTestId("diag-mismatch")).toBeVisible();
    await expect(page.getByTestId("diag-ok")).toHaveCount(0);

    // 2) Impor payload benar — override eksplisit di-reset ke null.
    await applyPayload(page, {
      mode: "new",
      packageType: "gram",
      packageSize: "500",
      packageQty: "2",
      priceMode: "package",
      pricePerPackage: "10000",
      displayBaseUnitOverride: null,
      displayPackageTypeOverride: null,
    });

    // Banner mismatch harus hilang, banner OK muncul kembali.
    await expect(page.getByTestId("diag-mismatch")).toHaveCount(0);
    await expect(page.getByTestId("diag-ok")).toBeVisible();

    // Label ikut sinkron dengan dropdown.
    await expect(page.getByTestId("diag-display-base-unit")).toHaveText("g");
    await expect(page.getByTestId("diag-display-package-type")).toHaveText(
      "gram",
    );
    await expect(page.getByTestId("diag-label-isi")).toHaveText(
      "“Isi / kemasan (g)”",
    );
    await expect(page.getByTestId("diag-label-harga-per-pkg")).toHaveText(
      "“Harga per gram”",
    );
  });
});