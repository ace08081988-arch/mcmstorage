import { test, expect, type Page } from "@playwright/test";

/**
 * Penutupan BERANTAI layer portal bertumpuk saat isinya re-render / lazy-load.
 *
 * Harness: /lovable/visual/focus-portal-stack (publik, no-auth) yang memakai
 * hook produksi `usePortalFocusStack` — sama dengan dialog pratinjau WA.
 *
 * Yang dijaga:
 *  1. Buka Dialog → Popover (isi lazy-load) → Select (isi lazy-load).
 *  2. Tutup Select → fokus kembali ke pemicu select DI DALAM popover.
 *  3. Tutup Popover → fokus kembali ke tombol "Pilih kontak" di dalam dialog.
 *  4. Fokus tidak pernah terdampar di <body> atau melompat ke luar dialog.
 */

const URL_HARNESS = "/lovable/visual/focus-portal-stack";

const activeTestId = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);

/** Testid elemen aktif atau leluhur terdekat yang punya testid. */
const activeOwnerTestId = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.closest("[data-testid]")?.getAttribute("data-testid") ?? null;
  });

async function openStack(page: Page) {
  await page.goto(URL_HARNESS);
  await page.getByTestId("base-trigger").click();
  await expect(page.getByTestId("stack-dialog")).toBeVisible();
  await page.getByTestId("pop-trigger").click();
  // Layer 1 lazy-load: "Memuat…" dulu, baru isinya.
  await expect(page.getByTestId("pop-loading")).toBeVisible();
  await expect(page.getByTestId("pop-item-1")).toBeVisible();
  await page.getByTestId("sel-trigger").click();
  // Layer 2 lazy-load.
  await expect(page.getByTestId("sel-content")).toBeVisible();
  await expect(page.getByTestId("sel-item-a")).toBeVisible();
}

test.describe("penutupan berantai portal bertumpuk", () => {
  test("select → popover ditutup berurutan, fokus pulih per-layer", async ({ page }) => {
    await openStack(page);

    // Stack debug harus mencatat DUA layer terbuka.
    const layers = await page.evaluate(
      () => (window as unknown as { __waFocusDebug: { state: () => { layers: unknown[] } } }).__waFocusDebug.state().layers.length,
    );
    expect(layers).toBeGreaterThanOrEqual(2);

    // Tutup layer teratas (select) — fokus balik ke pemicunya di dalam popover.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sel-content")).toBeHidden();
    await expect(page.getByTestId("pop-content")).toBeVisible();
    await expect.poll(() => activeOwnerTestId(page)).toBe("sel-trigger");

    // Tutup layer berikutnya (popover) — fokus balik ke tombol di dalam dialog.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("pop-content")).toBeHidden();
    await expect(page.getByTestId("stack-dialog")).toBeVisible();
    await expect.poll(() => activeOwnerTestId(page)).toBe("pop-trigger");

    // Tidak pernah terdampar di <body>.
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  });

  test("memilih item (select re-render) tetap memulihkan fokus berantai", async ({ page }) => {
    await openStack(page);

    // Pilih item: select menutup DAN isinya re-render (label nilai berubah).
    await page.getByTestId("sel-item-b").click();
    await expect(page.getByTestId("sel-content")).toBeHidden();
    await expect(page.getByTestId("sel-trigger")).toContainText("Paket B");
    await expect.poll(() => activeOwnerTestId(page)).toBe("sel-trigger");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("pop-content")).toBeHidden();
    await expect.poll(() => activeOwnerTestId(page)).toBe("pop-trigger");
  });

  test("tutup dua layer sekaligus (ESC beruntun cepat) tidak membuang fokus keluar dialog", async ({ page }) => {
    await openStack(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("pop-content")).toBeHidden();
    await expect(page.getByTestId("stack-dialog")).toBeVisible();
    const inside = await page.evaluate(() => {
      const dlg = document.querySelector('[data-testid="stack-dialog"]');
      return !!dlg && !!document.activeElement && dlg.contains(document.activeElement);
    });
    expect(inside).toBe(true);
  });

  test("Tab tetap terkurung di dialog setelah semua layer tertutup", async ({ page }) => {
    await openStack(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const dlg = document.querySelector('[data-testid="stack-dialog"]');
        return !!dlg && !!document.activeElement && dlg.contains(document.activeElement);
      });
      expect(inside).toBe(true);
    }
    expect(await activeTestId(page)).not.toBe("base-trigger");
  });

  test("dialog ditutup: fokus kembali ke pemicu dialog", async ({ page }) => {
    await openStack(page);
    await page.keyboard.press("Escape"); // select
    await page.keyboard.press("Escape"); // popover
    await page.getByTestId("dlg-last").click();
    await expect(page.getByTestId("stack-dialog")).toBeHidden();
    await expect.poll(() => activeOwnerTestId(page)).toBe("base-trigger");
  });
});
