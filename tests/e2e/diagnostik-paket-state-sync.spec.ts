import { test, expect } from "@playwright/test";

/**
 * E2E: sinkronisasi state diagnostic setelah impor payload benar.
 *
 * Untuk tiap varian payload (gram / botol / pcs / sachet, mode new &
 * existing), test memverifikasi bahwa nilai yang tampil pada:
 *   - dropdown form `packageType` (`diag-input-package-type`)
 *   - `displayPackageType` (`diag-display-package-type`)
 *   - `displayBaseUnit`    (`diag-display-base-unit`)
 *   - `displayPkgSize`     (`diag-display-pkg-size`)
 *   - `effPackageType`     (`diag-eff-package-type`)
 *   - `effBaseUnit`        (`diag-eff-base-unit`)
 * SAMA PERSIS dengan nilai yang diharapkan, dan banner OK tampil (bukti
 * display fields konsisten dengan derived setelah impor).
 */

const URL = "/diagnostik/paket";

type Payload = Record<string, unknown>;
type Expected = {
  packageType: "gram" | "pcs" | "botol" | "sachet";
  displayPackageType: "gram" | "pcs" | "botol" | "sachet";
  displayBaseUnit: "g" | "pcs";
  displayPkgSize: string;
  effPackageType: "gram" | "pcs" | "botol" | "sachet";
  effBaseUnit: "g" | "pcs";
};

async function applyPayload(
  page: import("@playwright/test").Page,
  payload: Payload,
) {
  const input = page.getByTestId("diag-payload-input");
  await input.fill("");
  await input.fill(JSON.stringify(payload));
  await page.getByTestId("diag-payload-apply").click();
  await expect(page.getByTestId("diag-payload-error")).toHaveCount(0);
}

async function expectState(
  page: import("@playwright/test").Page,
  exp: Expected,
) {
  await expect(page.getByTestId("diag-input-package-type")).toHaveValue(
    exp.packageType,
  );
  await expect(page.getByTestId("diag-display-package-type")).toHaveText(
    exp.displayPackageType,
  );
  await expect(page.getByTestId("diag-display-base-unit")).toHaveText(
    exp.displayBaseUnit,
  );
  await expect(page.getByTestId("diag-display-pkg-size")).toHaveText(
    exp.displayPkgSize,
  );
  await expect(page.getByTestId("diag-eff-package-type")).toHaveText(
    exp.effPackageType,
  );
  await expect(page.getByTestId("diag-eff-base-unit")).toHaveText(
    exp.effBaseUnit,
  );
  // Banner OK sebagai bukti sinkron.
  await expect(page.getByTestId("diag-ok")).toBeVisible();
  await expect(page.getByTestId("diag-mismatch")).toHaveCount(0);
}

const CASES: Array<{ name: string; payload: Payload; expect: Expected }> = [
  {
    name: "mode=new · gram/500",
    payload: {
      mode: "new",
      packageType: "gram",
      packageSize: "500",
      packageQty: "2",
      priceMode: "package",
      pricePerPackage: "10000",
      displayBaseUnitOverride: null,
      displayPackageTypeOverride: null,
    },
    expect: {
      packageType: "gram",
      displayPackageType: "gram",
      displayBaseUnit: "g",
      displayPkgSize: "500",
      effPackageType: "gram",
      effBaseUnit: "g",
    },
  },
  {
    name: "mode=new · botol/600",
    payload: {
      mode: "new",
      packageType: "botol",
      packageSize: "600",
      packageQty: "3",
      priceMode: "package",
      pricePerPackage: "15000",
      displayBaseUnitOverride: null,
      displayPackageTypeOverride: null,
    },
    expect: {
      packageType: "botol",
      displayPackageType: "botol",
      displayBaseUnit: "pcs",
      displayPkgSize: "600",
      effPackageType: "botol",
      effBaseUnit: "pcs",
    },
  },
  {
    name: "mode=new · pcs (packageSize dipaksa 1)",
    payload: {
      mode: "new",
      packageType: "pcs",
      packageSize: "999",
      packageQty: "5",
      priceMode: "package",
      pricePerPackage: "2500",
      displayBaseUnitOverride: null,
      displayPackageTypeOverride: null,
    },
    expect: {
      packageType: "pcs",
      displayPackageType: "pcs",
      displayBaseUnit: "pcs",
      displayPkgSize: "1",
      effPackageType: "pcs",
      effBaseUnit: "pcs",
    },
  },
  {
    name: "mode=new · sachet/10",
    payload: {
      mode: "new",
      packageType: "sachet",
      packageSize: "10",
      packageQty: "4",
      priceMode: "package",
      pricePerPackage: "5000",
      displayBaseUnitOverride: null,
      displayPackageTypeOverride: null,
    },
    expect: {
      packageType: "sachet",
      displayPackageType: "sachet",
      displayBaseUnit: "pcs",
      displayPkgSize: "10",
      effPackageType: "sachet",
      effBaseUnit: "pcs",
    },
  },
  {
    name: "mode=existing · selectedItem botol/600/pcs (menutupi packageType form)",
    payload: {
      mode: "existing",
      packageType: "gram", // sengaja beda — di mode existing tidak dipakai
      packageSize: "500",
      packageQty: "1",
      priceMode: "package",
      pricePerPackage: "12000",
      selectedItem: {
        package_type: "botol",
        package_size: "600",
        base_unit: "pcs",
      },
      displayBaseUnitOverride: null,
      displayPackageTypeOverride: null,
    },
    expect: {
      // dropdown form tetap tersimpan sesuai payload, TAPI display &
      // derived mengikuti selectedItem karena mode=existing.
      packageType: "gram",
      displayPackageType: "botol",
      displayBaseUnit: "pcs",
      displayPkgSize: "600",
      effPackageType: "botol",
      effBaseUnit: "pcs",
    },
  },
  {
    name: "mode=existing · selectedItem gram/250/g",
    payload: {
      mode: "existing",
      packageType: "pcs",
      packageSize: "1",
      packageQty: "2",
      priceMode: "package",
      pricePerPackage: "8000",
      selectedItem: {
        package_type: "gram",
        package_size: "250",
        base_unit: "g",
      },
      displayBaseUnitOverride: null,
      displayPackageTypeOverride: null,
    },
    expect: {
      packageType: "pcs",
      displayPackageType: "gram",
      displayBaseUnit: "g",
      displayPkgSize: "250",
      effPackageType: "gram",
      effBaseUnit: "g",
    },
  },
];

test.describe("/diagnostik/paket · sinkronisasi state pasca impor", () => {
  for (const c of CASES) {
    test(`impor benar → state tersinkron: ${c.name}`, async ({ page }) => {
      await page.goto(URL);
      await applyPayload(page, c.payload);
      await expectState(page, c.expect);
    });
  }
});