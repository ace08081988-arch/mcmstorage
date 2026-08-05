/**
 * Visual regression (screenshot diff) bilah bawah.
 *
 * Semua skenario dibandingkan ke SATU baseline yang sama
 * (`bottom-bar-strip.png`) karena strip 140px paling bawah layar HARUS
 * terlihat identik di setiap kondisi: begitu bilah bawah bergeser satu
 * piksel pun (scroll, navigasi, konten dinamis, keyboard/visual viewport),
 * diff langsung gagal.
 *
 * Harness: /lovable/visual/bottom-bar-snap (publik, tanpa auth) memakai
 * komponen `MobileBottomNav` ASLI.
 *
 * Jalankan: `bun run test:bottom-bar:visual`
 * Perbarui baseline: `bun run test:bottom-bar:visual -- --update-snapshots`
 */
import { test, expect, type Page } from "@playwright/test";

const HARNESS = "/lovable/visual/bottom-bar-snap?rows=60";
/** Tinggi strip bawah yang di-diff (mencakup bilah + safe-area). */
const STRIP_H = 140;
const SNAPSHOT = "bottom-bar-strip.png";

const nav = (page: Page) => page.getByRole("navigation", { name: "Navigasi utama" });

async function ready(page: Page) {
  await expect(nav(page)).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector("[data-bottom-bar-harness]");
          return el ? Object.keys(el).some((k) => k.startsWith("__reactFiber$")) : false;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(250);
}

/**
 * Screenshot strip paling bawah viewport (bukan full page).
 *
 * Konten daftar/header disembunyikan dengan `visibility: hidden` (bukan
 * `display: none`) tepat sebelum jepretan: layout & posisi scroll tidak
 * berubah, tapi latar di belakang bilah jadi konstan sehingga diff murni
 * mengukur posisi + tampilan bilah bawah.
 */
async function shootStrip(page: Page) {
  const size = page.viewportSize();
  if (!size) throw new Error("viewport size tidak tersedia");
  await page.addStyleTag({
    content:
      '[data-bottom-bar-harness] > ul, [data-bottom-bar-harness] > header { visibility: hidden !important; }',
  });
  await page.waitForTimeout(120);
  return page.screenshot({
    clip: { x: 0, y: size.height - STRIP_H, width: size.width, height: STRIP_H },
    animations: "disabled",
    caret: "hide",
  });
}

async function expectStripStable(page: Page) {
  expect(await shootStrip(page)).toMatchSnapshot(SNAPSHOT);
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS, { waitUntil: "domcontentloaded" });
  await ready(page);
});

test("baseline: bilah bawah saat halaman dimuat", async ({ page }) => {
  await expectStripStable(page);
});

test("strip bawah identik setelah digulir ke bawah dan kembali", async ({ page }) => {
  await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(400);
  await expectStripStable(page);

  await page.mouse.wheel(0, -1200);
  await page.waitForTimeout(400);
  await expectStripStable(page);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  await expectStripStable(page);
});

test("strip bawah identik setelah pindah halaman", async ({ page }) => {
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("go-next-page").click();
    await page.waitForTimeout(400);
    await expectStripStable(page);
  }
});

test("strip bawah identik setelah konten dinamis bertambah", async ({ page }) => {
  await page.getByTestId("add-rows").click();
  await page.waitForTimeout(400);
  await expectStripStable(page);

  await page.getByTestId("add-rows").click();
  await page.mouse.wheel(0, 6000);
  await page.waitForTimeout(400);
  await expectStripStable(page);
});

test("strip bawah identik setelah rotasi kembali ke portrait", async ({ page }) => {
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.height, height: size.width });
  await page.waitForTimeout(500);
  await page.setViewportSize(size);
  await page.waitForTimeout(500);
  await expectStripStable(page);
});
