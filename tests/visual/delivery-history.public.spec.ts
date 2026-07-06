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
const VIEWPORTS = [
  { name: "411", width: 411, height: 900 },
  { name: "320", width: 320, height: 700 },
] as const;
// --app-font-scale menskalakan seluruh rem lewat `html { font-size: calc(16px * var(--app-font-scale)) }`.
// 0.9 (compact) & 1.1 (comfortable) menstres truncate + min-w-0 di kartu.
const SCALES = [0.9, 1.0, 1.1] as const;

async function prep(
  page: Page,
  theme: (typeof THEMES)[number],
  vp: (typeof VIEWPORTS)[number],
  scale: number,
) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto(`${HARNESS}?theme=${theme}&scale=${scale}`, {
    waitUntil: "networkidle",
  });
  await page.evaluate(() =>
    (document as unknown as { fonts?: { ready: Promise<void> } }).fonts?.ready,
  );
  await page.waitForSelector('[data-visual-dialog]');
  // Pastikan class `dark` & --app-font-scale benar-benar terpasang sebelum snapshot.
  await page.waitForFunction(
    ({ t, s }) => {
      const isDarkOk =
        t === "dark"
          ? document.documentElement.classList.contains("dark")
          : !document.documentElement.classList.contains("dark");
      const applied = document.documentElement.style.getPropertyValue(
        "--app-font-scale",
      );
      return isDarkOk && Number(applied) === s;
    },
    { t: theme, s: scale },
  );
}

test.describe("DeliveryHistoryDialog — truncate/badge/chip", () => {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      for (const scale of SCALES) {
        const scaleName = scale.toFixed(2).replace(".", "_");
        test(`layout aman (${vp.name} · ${theme} · scale ${scale})`, async ({ page }) => {
          await prep(page, theme, vp, scale);
      const dialog = page.locator("[data-visual-dialog]");

      // 1. Dokumen tidak boleh punya horizontal scroll.
      const doc = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
          expect(
            doc.sw,
            `dokumen overflow horizontal (${vp.name}/${theme}/${scale})`,
          ).toBeLessThanOrEqual(doc.cw + 1);

      // 2. Kartu riwayat & chip tidak boleh melebihi bounding box container-nya
      //    (getBoundingClientRect — bukan scrollWidth, agar truncate tidak
      //     terdeteksi sebagai overflow palsu).
      const overflows = await dialog.evaluate((root) => {
        const parentRect = root.getBoundingClientRect();
        const bad: { sel: string; right: number; parentRight: number }[] = [];
        const targets = root.querySelectorAll<HTMLElement>(
          "[data-history-card], [data-history-card] .flex.flex-wrap > span",
        );
        targets.forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right - parentRect.right > 1) {
            bad.push({
              sel: el.getAttribute("data-history-card") !== null ? "card" : "chip",
              right: r.right,
              parentRight: parentRect.right,
            });
          }
        });
        return bad;
      });
          expect(
            overflows,
            `kartu/chip melebihi dialog (${vp.name}/${theme}/${scale}): ${JSON.stringify(overflows)}`,
          ).toEqual([]);

          await expect(dialog).toHaveScreenshot(
            `delivery-history-${vp.name}-${theme}-scale-${scaleName}.png`,
          );
        });
      }
    }
  }
});