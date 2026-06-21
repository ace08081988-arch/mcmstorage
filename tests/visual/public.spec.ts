import { test, expect } from "@playwright/test";
import { PUBLIC_ROUTES } from "./routes";

test.describe("public routes — visual", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} (${route.path})`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "networkidle" });
      // Wait for web fonts so glyph metrics are stable between runs.
      await page.evaluate(() => (document as any).fonts?.ready);
      await expect(page).toHaveScreenshot(`${route.name}.png`, {
        fullPage: true,
      });
    });
  }
});