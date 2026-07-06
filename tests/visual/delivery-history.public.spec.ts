import { test, expect, type Page } from "@playwright/test";

/**
 * Visual regression + overflow assert untuk DeliveryHistoryDialog di
 * mode terang & gelap pada viewport HP (411×900). Menggunakan harness
 * publik `/lovable/visual/delivery-history` (no auth, no network).
 *
 * Yang divalidasi:
 *  - Screenshot section dialog per tema.
 *  - Tidak ada elemen truncate/badge/chip yang meluber lebar viewport
 *    (scrollWidth > clientWidth) di dalam kartu riwayat.
 */

const HARNESS = "/lovable/visual/delivery-history";
const THEMES = ["light", "dark"] as const;

async function prep(page: Page, theme: (typeof THEMES)[number]) {
  await page.setViewportSize({ width: 411, height: 900 });
  await page.goto(`${HARNESS}?theme=${theme}`, { waitUntil: "networkidle" });
  await page.evaluate(() =>
    (document as unknown as { fonts?: { ready: Promise<void> } }).fonts?.ready,
  );
  await page.waitForSelector('[data-visual-dialog]');
  // Pastikan class `dark` benar-benar terpasang sebelum snapshot.
  await page.waitForFunction(
    (t) =>
      t === "dark"
        ? document.documentElement.classList.contains("dark")
        : !document.documentElement.classList.contains("dark"),
    theme,
  );
}

test.describe("DeliveryHistoryDialog — truncate/badge/chip", () => {
  for (const theme of THEMES) {
    test(`layout aman (${theme})`, async ({ page }) => {
      await prep(page, theme);
      const dialog = page.locator("[data-visual-dialog]");

      // Assert: tidak ada anak dialog yang melebihi lebar kontainer.
      const overflows = await dialog.evaluate((root) => {
        const bad: { tag: string; cls: string; sw: number; cw: number }[] = [];
        const all = root.querySelectorAll<HTMLElement>("*");
        all.forEach((el) => {
          // Sengaja izinkan container yang scrollable (max-h-[60vh]).
          const style = getComputedStyle(el);
          if (style.overflowY === "auto" || style.overflowY === "scroll") return;
          if (el.scrollWidth - el.clientWidth > 1) {
            bad.push({
              tag: el.tagName.toLowerCase(),
              cls: el.className.toString().slice(0, 120),
              sw: el.scrollWidth,
              cw: el.clientWidth,
            });
          }
        });
        return bad;
      });
      expect(overflows, `overflow di tema ${theme}: ${JSON.stringify(overflows)}`).toEqual([]);

      await expect(dialog).toHaveScreenshot(`delivery-history-${theme}.png`);
    });
  }
});