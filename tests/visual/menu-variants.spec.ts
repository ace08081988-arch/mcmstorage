/**
 * Visual regression seluruh variasi menu (terang + gelap).
 *
 * Harness: /lovable/visual/menu-variants (noindex, tanpa auth) yang
 * merender komponen menu ASLI: sidebar item (class SSOT), PillsTabs,
 * MobileBottomNav, dan ChatBottomNav.
 *
 * Yang dijaga:
 *  1. Snapshot PNG tiap permukaan menu di mode terang & gelap.
 *  2. Warna aktif berasal dari token tema (bukan palet Tailwind mentah).
 *  3. Ukuran label bottom nav konsisten antar permukaan (main vs chat).
 *  4. Tap target tiap tab ≥ 44px.
 *
 * Jalankan: `bun run test:menu` (project `menu-variants`).
 */
import { test, expect, type Page } from "@playwright/test";

const THEMES = ["light", "dark"] as const;
const MIN_TAP_PX = 44;

async function openHarness(
  page: Page,
  theme: (typeof THEMES)[number],
  nav: "main" | "chat",
) {
  // Harness tidak butuh data; blokir REST supaya badge/network tidak flaky.
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto(`/lovable/visual/menu-variants?theme=${theme}&nav=${nav}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector(`[data-menu-harness][data-menu-theme="${theme}"]`);
  await page.waitForSelector('[data-menu-shot="sidebar"] [data-menu-item]');
  // Tunggu font + transisi selesai supaya snapshot stabil.
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(250);
}

function rgbToTuple(v: string): number[] {
  return (v.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
}

/** Jarak warna sederhana — toleransi antialias/opacity kecil. */
function close(a: string, b: string, tol = 12): boolean {
  const x = rgbToTuple(a);
  const y = rgbToTuple(b);
  if (x.length < 3 || y.length < 3) return false;
  return x.every((n, i) => Math.abs(n - (y[i] ?? 0)) <= tol);
}

for (const theme of THEMES) {
  test.describe(`menu ${theme}`, () => {
    test(`snapshot sidebar + pills (${theme})`, async ({ page }) => {
      await openHarness(page, theme, "main");
      await expect(page.locator('[data-menu-shot="sidebar"]')).toHaveScreenshot(
        `menu-sidebar-${theme}.png`,
      );
      await expect(page.locator('[data-menu-shot="pills"]')).toHaveScreenshot(
        `menu-pills-${theme}.png`,
      );
    });

    test(`snapshot bottom nav utama + chat (${theme})`, async ({ page }) => {
      await openHarness(page, theme, "main");
      await expect(page.locator("nav").first()).toHaveScreenshot(
        `menu-bottom-nav-main-${theme}.png`,
      );

      await openHarness(page, theme, "chat");
      await expect(
        page.locator('nav[aria-label="Navigasi utama chat"]'),
      ).toHaveScreenshot(`menu-bottom-nav-chat-${theme}.png`);
    });

    test(`warna item aktif berasal dari token tema (${theme})`, async ({ page }) => {
      await openHarness(page, theme, "main");

      const tokens = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const probe = (value: string) => {
          const el = document.createElement("span");
          el.style.color = value;
          document.body.appendChild(el);
          const out = getComputedStyle(el).color;
          el.remove();
          return out;
        };
        return {
          primary: probe(cs.getPropertyValue("--primary").trim()),
          sidebarAccentFg: probe(
            cs.getPropertyValue("--sidebar-accent-foreground").trim(),
          ),
          mutedFg: probe(cs.getPropertyValue("--muted-foreground").trim()),
        };
      });

      const activeSidebarLabel = page.locator(
        '[data-menu-surface="sidebar"][data-menu-state="active"] [data-menu-label]',
      );
      const activeColor = await activeSidebarLabel.evaluate(
        (el) => getComputedStyle(el).color,
      );
      expect(
        close(activeColor, tokens.sidebarAccentFg) ||
          close(activeColor, tokens.primary),
        `label sidebar aktif harus memakai token tema, dapat ${activeColor}`,
      ).toBe(true);

      // Tab pill aktif memakai primary sebagai latar.
      const activePillBg = await page
        .locator('[data-menu-shot="pills"] [role="tab"][aria-selected="true"]')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(
        close(activePillBg, tokens.primary, 20),
        `pill aktif harus bg primary, dapat ${activePillBg}`,
      ).toBe(true);

      // Tab bottom nav idle memakai muted-foreground (bukan abu-abu mentah).
      const idleNavColor = await page
        .locator("nav a[aria-current!='page']")
        .first()
        .evaluate((el) => getComputedStyle(el).color);
      expect(
        close(idleNavColor, tokens.mutedFg, 20),
        `tab idle harus muted-foreground, dapat ${idleNavColor}`,
      ).toBe(true);
    });

    test(`tipografi & tap target menu konsisten (${theme})`, async ({ page }) => {
      const read = async (nav: "main" | "chat") => {
        await openHarness(page, theme, nav);
        return page.evaluate(() => {
          const labels = Array.from(
            document.querySelectorAll<HTMLElement>("nav [data-nav-label]"),
          );
          const tabs = Array.from(
            document.querySelectorAll<HTMLElement>("nav a, nav > div > button"),
          );
          return {
            fontSizes: labels.map(
              (el) => Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100,
            ),
            heights: tabs.map((el) => Math.round(el.getBoundingClientRect().height)),
          };
        });
      };

      const main = await read("main");
      const chat = await read("chat");

      // Semua label dalam satu bar berukuran sama…
      for (const set of [main.fontSizes, chat.fontSizes]) {
        expect(set.length).toBeGreaterThan(0);
        expect(new Set(set).size).toBe(1);
      }
      // …dan sama antara bottom nav utama vs chat.
      expect(main.fontSizes[0]).toBeCloseTo(chat.fontSizes[0] ?? 0, 1);

      for (const h of [...main.heights, ...chat.heights]) {
        expect(h).toBeGreaterThanOrEqual(MIN_TAP_PX);
      }
    });
  });
}
