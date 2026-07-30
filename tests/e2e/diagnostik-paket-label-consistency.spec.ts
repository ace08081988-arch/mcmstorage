import { test, expect } from "@playwright/test";

/**
 * E2E: label "Isi / kemasan", "Harga per", dan "Ringkasan · yang tersedia"
 * pada halaman /diagnostik/paket harus SELALU konsisten dengan pilihan
 * dropdown "Jenis kemasan" (gram / botol / pcs) setelah state di-hydrate
 * dari payload lewat form "Impor payload".
 *
 * Kontrak label (sumber: src/routes/diagnostik.paket.tsx & _authenticated.gudang.tsx):
 *   - Isi / kemasan     → "Isi / kemasan (<baseUnit>)"
 *   - Harga per (base)  → "Harga per <baseUnit> (Rp)"
 *   - Harga per (pkg)   → "Harga per <packageType>"
 *   - Ringkasan (≠pcs)  → "<qty> <packageType> · <pkgSize> <baseUnit>"
 *   - Ringkasan (pcs)   → "<qty> <packageType>"
 *
 * defaultBaseUnit: gram → "g", botol → "pcs", pcs → "pcs", sachet → "pcs".
 */

const URL = "/diagnostik/paket";

type Case = {
  name: string;
  payload: Record<string, unknown>;
  packageType: "gram" | "botol" | "pcs";
  baseUnit: "g" | "pcs";
  qty: number;
  pkgSize: number;
};

const CASES: Case[] = [
  {
    name: "gram → base=g",
    payload: {
      mode: "new",
      packageType: "gram",
      packageSize: "500",
      packageQty: "2",
      priceMode: "package",
      pricePerPackage: "10000",
    },
    packageType: "gram",
    baseUnit: "g",
    qty: 2,
    pkgSize: 500,
  },
  {
    name: "botol → base=pcs",
    payload: {
      mode: "new",
      packageType: "botol",
      packageSize: "600",
      packageQty: "3",
      priceMode: "package",
      pricePerPackage: "15000",
    },
    packageType: "botol",
    baseUnit: "pcs",
    qty: 3,
    pkgSize: 600,
  },
  {
    name: "pcs → base=pcs (ringkasan tanpa pkgSize)",
    payload: {
      mode: "new",
      packageType: "pcs",
      packageSize: "1",
      packageQty: "5",
      priceMode: "package",
      pricePerPackage: "2000",
    },
    packageType: "pcs",
    baseUnit: "pcs",
    qty: 5,
    pkgSize: 1,
  },
];

test.describe("/diagnostik/paket · konsistensi label ↔ Jenis kemasan", () => {
  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      await page.goto(URL);

      // Impor payload → hydrate state.
      await page
        .getByTestId("diag-payload-input")
        .fill(JSON.stringify(c.payload));
      await page.getByTestId("diag-payload-apply").click();

      // Tidak boleh ada error parse.
      await expect(page.getByTestId("diag-payload-error")).toHaveCount(0);

      // Dropdown Jenis kemasan sudah reflect payload.
      await expect(page.getByTestId("diag-input-package-type")).toHaveValue(
        c.packageType,
      );

      // Display fields konsisten (mismatch banner TIDAK muncul).
      await expect(page.getByTestId("diag-ok")).toBeVisible();
      await expect(page.getByTestId("diag-mismatch")).toHaveCount(0);

      await expect(page.getByTestId("diag-display-package-type")).toHaveText(
        c.packageType,
      );
      await expect(page.getByTestId("diag-display-base-unit")).toHaveText(
        c.baseUnit,
      );

      // ---- Kontrak label render ----
      await expect(page.getByTestId("diag-label-isi")).toHaveText(
        `“Isi / kemasan (${c.baseUnit})”`,
      );
      await expect(page.getByTestId("diag-label-harga-per-base")).toHaveText(
        `“Harga per ${c.baseUnit} (Rp)”`,
      );
      await expect(page.getByTestId("diag-label-harga-per-pkg")).toHaveText(
        `“Harga per ${c.packageType}”`,
      );

      const expectedRingkasan =
        c.packageType === "pcs"
          ? `“${c.qty} ${c.packageType}”`
          : `“${c.qty} ${c.packageType} · ${c.pkgSize} ${c.baseUnit}”`;
      await expect(page.getByTestId("diag-label-ringkasan")).toHaveText(
        expectedRingkasan,
      );
    });
  }

  test("switch dropdown pasca impor tetap konsisten (gram → botol)", async ({
    page,
  }) => {
    await page.goto(URL);

    await page.getByTestId("diag-payload-input").fill(
      JSON.stringify({
        mode: "new",
        packageType: "gram",
        packageSize: "500",
        packageQty: "1",
        priceMode: "package",
        pricePerPackage: "10000",
      }),
    );
    await page.getByTestId("diag-payload-apply").click();
    await expect(page.getByTestId("diag-label-isi")).toHaveText(
      "“Isi / kemasan (g)”",
    );

    // Ubah dropdown ke botol — label & ringkasan harus ikut berubah,
    // TIDAK boleh ada campur aduk (mis. base=g padahal packageType=botol).
    await page
      .getByTestId("diag-input-package-type")
      .selectOption("botol");

    await expect(page.getByTestId("diag-display-package-type")).toHaveText(
      "botol",
    );
    await expect(page.getByTestId("diag-display-base-unit")).toHaveText("pcs");
    await expect(page.getByTestId("diag-label-isi")).toHaveText(
      "“Isi / kemasan (pcs)”",
    );
    await expect(page.getByTestId("diag-label-harga-per-base")).toHaveText(
      "“Harga per pcs (Rp)”",
    );
    await expect(page.getByTestId("diag-label-harga-per-pkg")).toHaveText(
      "“Harga per botol”",
    );
    await expect(page.getByTestId("diag-mismatch")).toHaveCount(0);
  });

  test("payload JSON invalid → error terlihat, state tidak berubah", async ({
    page,
  }) => {
    await page.goto(URL);

    const before = await page
      .getByTestId("diag-display-package-type")
      .textContent();

    await page.getByTestId("diag-payload-input").fill("{not json");
    await page.getByTestId("diag-payload-apply").click();

    await expect(page.getByTestId("diag-payload-error")).toBeVisible();
    await expect(page.getByTestId("diag-display-package-type")).toHaveText(
      before ?? "gram",
    );
  });
});
