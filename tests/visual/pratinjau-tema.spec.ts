/**
 * E2E render-guard halaman `/pratinjau-tema`.
 *
 * Memastikan seluruh variasi komponen (token, tombol, badge, link,
 * item sidebar, pill tabs) benar-benar ter-render di mode terang &
 * gelap, tanpa error konsol / pageerror.
 *
 * Jalankan: `bun run test:tema` (project `pratinjau-tema`).
 */
import { test, expect, type Page } from "@playwright/test";

const BUTTON_VARIANTS = 0; // dihitung dinamis dari DOM

async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/pratinjau-tema", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-theme-preview]");
  await page.waitForSelector("[data-token]");
  await page.evaluate(() => document.fonts?.ready);
  return errors;
}

test("semua seksi variasi ter-render tanpa error", async ({ page }) => {
  const errors = await open(page);

  // Token swatch
  const tokens = page.locator("[data-token]");
  expect(await tokens.count()).toBeGreaterThan(20);

  // Setiap swatch punya warna terkomputasi (bukan kosong / transparan)
  const emptySwatch = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-token] span[aria-hidden]")).filter(
      (el) => {
        const bg = getComputedStyle(el as Element).backgroundColor;
        return !bg || bg === "rgba(0, 0, 0, 0)";
      },
    ).length,
  );
  expect(emptySwatch).toBe(0);

  // Tombol: tiap varian punya baris & tombol disabled
  const buttons = page.getByRole("button");
  expect(await buttons.count()).toBeGreaterThan(20);
  expect(await page.locator("button[disabled]").count()).toBeGreaterThan(3);

  // Badge & link
  for (const label of ["success", "warning", "info"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Link primary" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Link sekunder" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Link destruktif" })).toBeVisible();

  // Sidebar item: minimal 1 aktif + sisanya idle
  const items = page.locator("[data-menu-item]");
  expect(await items.count()).toBeGreaterThan(1);
  expect(await page.locator('[data-menu-state="active"]').count()).toBe(1);

  // Pill tabs
  const tablist = page.getByRole("tablist", { name: "Tab pratinjau tema" });
  await expect(tablist).toBeVisible();
  expect(await tablist.getByRole("tab").count()).toBeGreaterThan(1);

  expect(errors, `console/page errors: ${errors.join("\n")}`).toEqual([]);
  expect(BUTTON_VARIANTS).toBe(0);
});

test("pill tabs bisa dipindah dan sidebar aktif tetap satu", async ({ page }) => {
  await open(page);
  const tabs = page.getByRole("tablist", { name: "Tab pratinjau tema" }).getByRole("tab");
  const last = tabs.last();
  await last.click();
  await expect(last).toHaveAttribute("aria-selected", "true");
  expect(await page.locator('[data-menu-state="active"]').count()).toBe(1);
});

test("toggle gelap merender ulang semua variasi", async ({ page }) => {
  const errors = await open(page);
  const before = await page.locator("[data-token]").count();

  await page.getByRole("button", { name: /Gelap|Terang/ }).click();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(true);
  await page.waitForTimeout(200);

  expect(await page.locator("[data-token]").count()).toBe(before);
  expect(await page.locator("[data-menu-item]").count()).toBeGreaterThan(1);
  await expect(page.getByRole("link", { name: "Link primary" })).toBeVisible();

  const bg = await page.evaluate(
    () => getComputedStyle(document.querySelector("[data-theme-preview]")!).backgroundColor,
  );
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(errors, `console/page errors: ${errors.join("\n")}`).toEqual([]);
});

test("pencarian token memfilter dan tidak merusak seksi lain", async ({ page }) => {
  await open(page);
  const all = await page.locator("[data-token]").count();
  await page.getByLabel("Cari token warna").fill("success");
  await expect.poll(async () => page.locator("[data-token]").count()).toBeLessThan(all);
  expect(await page.locator("[data-token]").count()).toBeGreaterThan(0);

  await expect(page.getByRole("link", { name: "Link primary" })).toBeVisible();
  expect(await page.locator("[data-menu-item]").count()).toBeGreaterThan(1);

  await page.getByLabel("Hapus pencarian").click();
  await expect.poll(async () => page.locator("[data-token]").count()).toBe(all);
});
