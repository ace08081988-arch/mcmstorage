import { test, expect, type Page } from "@playwright/test";

/**
 * Sidebar highlight sync — validates that the active menu item in
 * AppSidebar follows the current route, including child routes such as
 * /chat/$id and /gudang/pesanan/$id, and is unaffected by search params.
 *
 * Requires the `mobile-admin` Playwright project (authenticated storage
 * state). Spec is skipped automatically when storageState is empty.
 */

async function ensureSignedIn(page: Page) {
  await page.goto("/");
  if (page.url().includes("/auth")) test.skip(true, "No auth storage state — set TEST_EMAIL/TEST_PASSWORD.");
}

async function openSidebar(page: Page) {
  // On mobile viewport the sidebar lives in a Sheet — open it if a trigger exists.
  const trigger = page.getByRole("button", { name: /toggle sidebar|menu/i }).first();
  if (await trigger.isVisible().catch(() => false)) await trigger.click();
}

async function expectActive(page: Page, label: string) {
  await openSidebar(page);
  const link = page.getByRole("link", { name: label, exact: true }).first();
  await expect(link).toBeVisible();
  const button = link.locator("xpath=ancestor::*[@data-sidebar='menu-button'][1]");
  await expect(button).toHaveAttribute("data-active", "true");
}

test.describe("Sidebar highlight follows active route", () => {
  test.beforeEach(async ({ page }) => ensureSignedIn(page));

  for (const { label, path } of [
    { label: "Beranda", path: "/" },
    { label: "Gudang & Supplier", path: "/gudang" },
    { label: "Penyiapan Ecer", path: "/ecer" },
    { label: "Penyiapan Request", path: "/request" },
    { label: "Chat", path: "/chat" },
    { label: "Profil Akun", path: "/profil" },
  ]) {
    test(`top-level: ${path}`, async ({ page }) => {
      await page.goto(path);
      await expectActive(page, label);
    });
  }

  test("search params do not break highlight (/ecer?item=…&highlight=…)", async ({ page }) => {
    await page.goto("/ecer?item=dummy&highlight=dummy");
    await expectActive(page, "Penyiapan Ecer");
  });

  test("child route /chat/$id keeps Chat active", async ({ page }) => {
    await page.goto("/chat");
    const firstConv = page.locator('a[href^="/chat/"]').first();
    if (!(await firstConv.isVisible().catch(() => false))) test.skip(true, "No conversations available in test data.");
    await firstConv.click();
    await expect(page).toHaveURL(/\/chat\/[^/]+/);
    await expectActive(page, "Chat");
  });

  test("child route /gudang/pesanan/$id keeps Gudang active", async ({ page }) => {
    await page.goto("/gudang");
    const firstOrder = page.locator('a[href^="/gudang/pesanan/"]').first();
    if (!(await firstOrder.isVisible().catch(() => false))) test.skip(true, "No orders available in test data.");
    await firstOrder.click();
    await expect(page).toHaveURL(/\/gudang\/pesanan\/[^/]+/);
    await expectActive(page, "Gudang & Supplier");
  });

  test("home card → /ecer pivots highlight from Beranda to Penyiapan Ecer", async ({ page }) => {
    await page.goto("/");
    await expectActive(page, "Beranda");
    const card = page.locator('a[href^="/ecer"]').first();
    if (!(await card.isVisible().catch(() => false))) test.skip(true, "No ready-ecer cards.");
    await card.click();
    await expect(page).toHaveURL(/\/ecer/);
    await expectActive(page, "Penyiapan Ecer");
  });
});