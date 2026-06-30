import { test, expect, type Page } from "@playwright/test";

/**
 * Visual regression daftar produk pada 4 lebar Android umum
 * (320 / 360 / 411 / 480 px) untuk mencegah regresi wrapping/overflow
 * pada badge Status, nama produk, dan baris detail.
 *
 * Fixture publik (no auth, no network):
 *   /lovable/visual/produk-list?part=hero|status-grid|detail-rows
 *
 * Proyek Playwright (lihat playwright.config.ts):
 *   - produk-list-320, -360, -411, -480
 */

const HARNESS = "/lovable/visual/produk-list";
const PARTS = [
  { name: "hero", part: "hero" },
  { name: "status-grid", part: "status-grid" },
  { name: "detail-rows", part: "detail-rows" },
] as const;

async function prep(page: Page, part: string) {
  await page.goto(`${HARNESS}?part=${part}`, { waitUntil: "networkidle" });
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<void> } }).fonts?.ready);
  // Pastikan section harness sudah ter-mount sebelum capture.
  await page.waitForSelector(`[data-visual-part="${part}"]`);
}

test.describe("daftar produk — wrapping/overflow", () => {
  for (const p of PARTS) {
    test(`${p.name}`, async ({ page }) => {
      await prep(page, p.part);
      const section = page.locator(`[data-visual-part="${p.part}"]`);
      await expect(section).toHaveScreenshot(`${p.name}.png`, {
        animations: "disabled",
        caret: "hide",
      });
    });
  }
});
