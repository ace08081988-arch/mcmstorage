import { test, expect, type Page } from "@playwright/test";

/**
 * Visual + assertion regression untuk baris tombol Lokasi worker
 * (input Link Maps + GPS otomatis + Tempel) pada lebar Android sempit.
 *
 * Fixture publik (no auth, no network):
 *   /lovable/visual/prep-loc-buttons?variant=prep|request&state=idle|loading|filled
 *
 * Proyek Playwright (lihat playwright.config.ts):
 *   - prep-loc-buttons-390
 *   - prep-loc-buttons-411
 *
 * Tujuan:
 *  1. Snapshot per (variant × state) supaya perubahan layout mudah dilihat.
 *  2. Assertion runtime: tombol GPS & Tempel tidak boleh ke-clip
 *     (scrollWidth ≤ clientWidth) di kedua lebar, apa pun state-nya.
 */

const HARNESS = "/lovable/visual/prep-loc-buttons";

const VARIANTS = ["prep", "request"] as const;
const STATES = ["idle", "loading", "filled"] as const;

async function prep(page: Page, variant: string, state: string) {
  await page.goto(`${HARNESS}?variant=${variant}&state=${state}`, {
    waitUntil: "networkidle",
  });
  await page.evaluate(() =>
    (document as unknown as { fonts?: { ready: Promise<void> } }).fonts?.ready,
  );
  await page.waitForSelector('[data-visual-part="loc-row"]');
}

test.describe("worker loc buttons — no clipping @ narrow width", () => {
  for (const variant of VARIANTS) {
    for (const state of STATES) {
      test(`${variant}/${state}`, async ({ page }, testInfo) => {
        await prep(page, variant, state);

        const section = page.locator('[data-visual-part="loc-row"]');
        const gps = page.locator("[data-visual-gps-btn]");
        const paste = page.locator("[data-visual-paste-btn]");

        // 1. Assertion runtime: tombol tidak boleh overflow horizontal
        //    (scrollWidth ≤ clientWidth + 1 untuk toleransi subpixel).
        for (const btn of [gps, paste]) {
          const metrics = await btn.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return {
              scrollWidth: (el as HTMLElement).scrollWidth,
              clientWidth: (el as HTMLElement).clientWidth,
              right: rect.right,
              viewportWidth:
                document.documentElement.clientWidth || window.innerWidth,
            };
          });
          expect(
            metrics.scrollWidth,
            `${await btn.getAttribute("data-visual-gps-btn") ?? "paste"} overflow: scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`,
          ).toBeLessThanOrEqual(metrics.clientWidth + 1);
          expect(
            metrics.right,
            `button right (${metrics.right}) melewati viewport (${metrics.viewportWidth})`,
          ).toBeLessThanOrEqual(metrics.viewportWidth + 1);
        }

        // 2. Assertion runtime: kedua tombol tampil sebagai grid 2 kolom
        //    dengan lebar identik (grid-cols-2 gap-ms-2).
        const [gpsBox, pasteBox] = await Promise.all([
          gps.boundingBox(),
          paste.boundingBox(),
        ]);
        expect(gpsBox).not.toBeNull();
        expect(pasteBox).not.toBeNull();
        if (gpsBox && pasteBox) {
          expect(Math.abs(gpsBox.width - pasteBox.width)).toBeLessThanOrEqual(1);
          // Sejajar horizontal (bukan wrap ke baris kedua)
          expect(Math.abs(gpsBox.y - pasteBox.y)).toBeLessThanOrEqual(1);
        }

        // 3. Snapshot per state supaya regresi visual (label hilang,
        //    ikon menutup teks, dsb.) langsung ketahuan.
        await expect(section).toHaveScreenshot(
          `${testInfo.project.name}-${variant}-${state}.png`,
          { animations: "disabled", caret: "hide" },
        );
      });
    }
  }
});