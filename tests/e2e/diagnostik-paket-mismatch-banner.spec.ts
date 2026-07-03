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
 *   1. Payload dengan override menyimpang → banner mismatch muncul dengan
 *      teks spesifik (baseUnit yang dideteksi vs effBaseUnit), ikon "⚠",
 *      dan styling merah yang benar.
 *   2. Sebelum banner menghilang, teks + ikon + styling dikunci; setelah
 *      payload benar (override null), banner OK dengan ikon "✓" + styling
 *      emerald yang muncul.
 */

const URL = "/diagnostik/paket";

async function applyPayload(page: import("@playwright/test").Page, payload: unknown) {
  const input = page.getByTestId("diag-payload-input");
  await input.fill("");
  await input.fill(JSON.stringify(payload));
  await page.getByTestId("diag-payload-apply").click();
  await expect(page.getByTestId("diag-payload-error")).toHaveCount(0);
}

// Regex kelas Tailwind untuk styling banner. Cek per-token agar tahan
// terhadap urutan class dan modifier dark:.
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

test.describe("/diagnostik/paket · banner mismatch", () => {
  test("displayBaseUnitOverride menyimpang → banner + teks spesifik + ikon ⚠ + styling merah", async ({
    page,
  }) => {
    await page.goto(URL);

    // Baseline: state default konsisten.
    const okBaseline = page.getByTestId("diag-ok");
    await expect(okBaseline).toBeVisible();
    await expect(okBaseline).toContainText("✓");
    await expect(okBaseline).toContainText(
      "display fields konsisten dengan derived",
    );
    await expectAllClasses(okBaseline, OK_CLASS_TOKENS);
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

    // Judul + ikon peringatan.
    const heading = mismatch.locator("h2");
    await expect(heading).toHaveText("⚠ Mismatch terdeteksi");

    // Styling banner mismatch (merah).
    await expectAllClasses(mismatch, MISMATCH_CLASS_TOKENS);

    // Teks pesan menyebut baseUnit yang dideteksi (pcs) VS effBaseUnit (g).
    // Format hasil: "displayBaseUnit (pcs) ≠ effBaseUnit (g)".
    const bullets = mismatch.locator("li");
    await expect(bullets).toHaveCount(1);
    await expect(bullets.first()).toHaveText(
      "displayBaseUnit (pcs) ≠ effBaseUnit (g)",
    );

    // Display & label mengikuti override (bukti label benar-benar stale).
    await expect(page.getByTestId("diag-display-base-unit")).toHaveText("pcs");
    await expect(page.getByTestId("diag-eff-base-unit")).toHaveText("g");
    await expect(page.getByTestId("diag-label-isi")).toHaveText(
      "“Isi / kemasan (pcs)”",
    );
  });

  test("displayPackageTypeOverride menyimpang → banner + teks spesifik packageType", async ({
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
    await expect(mismatch.locator("h2")).toHaveText("⚠ Mismatch terdeteksi");
    await expectAllClasses(mismatch, MISMATCH_CLASS_TOKENS);
    // Format pesan: "displayPackageType (botol) ≠ effPackageType (gram)".
    await expect(mismatch.locator("li").first()).toHaveText(
      "displayPackageType (botol) ≠ effPackageType (gram)",
    );
    await expect(page.getByTestId("diag-display-package-type")).toHaveText(
      "botol",
    );
    await expect(page.getByTestId("diag-eff-package-type")).toHaveText("gram");
  });

  test("banner mismatch (teks + ikon + styling) dikunci sebelum menghilang, lalu banner OK muncul", async ({
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

    // Kunci teks + ikon + styling SEBELUM banner menghilang.
    const mismatch = page.getByTestId("diag-mismatch");
    await expect(mismatch).toBeVisible();
    await expect(page.getByTestId("diag-ok")).toHaveCount(0);
    await expect(mismatch.locator("h2")).toHaveText("⚠ Mismatch terdeteksi");
    await expectAllClasses(mismatch, MISMATCH_CLASS_TOKENS);
    // Dua penyimpangan → dua bullet spesifik.
    const bullets = mismatch.locator("li");
    await expect(bullets).toHaveCount(2);
    await expect(bullets).toHaveText([
      "displayPackageType (botol) ≠ effPackageType (gram)",
      "displayBaseUnit (pcs) ≠ effBaseUnit (g)",
    ]);

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

    // Banner mismatch harus hilang, banner OK muncul kembali dengan ikon ✓
    // dan styling emerald.
    await expect(page.getByTestId("diag-mismatch")).toHaveCount(0);
    const ok = page.getByTestId("diag-ok");
    await expect(ok).toBeVisible();
    await expect(ok).toContainText("✓");
    await expect(ok).toContainText(
      "display fields konsisten dengan derived",
    );
    await expectAllClasses(ok, OK_CLASS_TOKENS);

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