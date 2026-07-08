/**
 * Regresi UX: seluruh tombol toolbar PhotoEditor (Pilih, Coret, Teks,
 * Stiker, Panah, Kotak, Lingkaran) DAN footer (Batal, Simpan) HARUS:
 *  - berada di dalam viewport (tidak terpotong sisi bawah)
 *  - lolos hit-test Playwright (`click({ trial: true })` — mencakup
 *    aktionabilitas + tidak tertimpa overlay)
 *  - benar-benar mengubah state ketika di-click (aria-pressed=true
 *    untuk tool button)
 *
 * Diuji pada beberapa viewport, termasuk 411×740 yang sempat memicu
 * regresi "tombol Lingkaran terpotong" sebelum panel toolbar
 * di-scrollable.
 */
import { test, expect, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "320x568", w: 320, h: 568 },
  { name: "360x640", w: 360, h: 640 },
  { name: "411x740", w: 411, h: 740 }, // regresi guard
  { name: "411x878", w: 411, h: 878 },
  { name: "411x893", w: 411, h: 893 },
  { name: "768x1024", w: 768, h: 1024 },
];

const TOOL_LABELS = ["Pilih", "Coret", "Teks", "Stiker", "Panah", "Kotak", "Lingkaran"] as const;

async function openEditor(page: Page) {
  await page.goto("/lovable/visual/photo-editor");
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>('[data-testid="harness-status"]')?.dataset.status ===
      "open",
  );
  await page.waitForSelector("canvas");
}

function toolbar(page: Page) {
  return page.getByRole("toolbar", { name: "Toolbar editor foto" });
}

async function assertClickable(page: Page, locator: ReturnType<Page["getByRole"]>, viewportH: number, viewportW: number) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `bounding box missing`).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportH);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewportW);
  // hit-test aktual (memeriksa overlay/pointer-events)
  await locator.click({ trial: true });
}

for (const vp of VIEWPORTS) {
  test.describe(`PhotoEditor toolbar @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test("semua tombol tool terlihat, di dalam viewport, dan aktionabel", async ({ page }) => {
      await openEditor(page);

      for (const label of TOOL_LABELS) {
        const btn = toolbar(page).getByRole("button", { name: new RegExp(`^${label}(?:\\s|$)`) });
        await assertClickable(page, btn, vp.h, vp.w);
        // klik nyata → aria-pressed harus true (mengubah state tool)
        await btn.click();
        await expect(btn).toHaveAttribute("aria-pressed", "true");
      }

      // Footer Batal & Simpan
      const cancel = page.getByRole("button", { name: "Batal", exact: true });
      const save = page.getByRole("button", { name: "Simpan", exact: true });
      await assertClickable(page, cancel, vp.h, vp.w);
      await assertClickable(page, save, vp.h, vp.w);
    });

    test("tombol Help (?) toolbar tetap terlihat & aktionabel", async ({ page }) => {
      await openEditor(page);
      const help = toolbar(page).getByRole("button", { name: "Panduan singkat tiap tool" });
      await assertClickable(page, help, vp.h, vp.w);
      await help.click();
      await expect(help).toHaveAttribute("aria-expanded", "true");
    });
  });
}
