import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { ADMIN_ROUTES } from "./routes";

const STATE = "tests/visual/.auth/user.json";
const hasSession = (() => {
  if (!existsSync(STATE)) return false;
  try {
    const j = JSON.parse(readFileSync(STATE, "utf8"));
    return Array.isArray(j.origins) && j.origins.length > 0;
  } catch {
    return false;
  }
})();

test.describe("admin routes — visual", () => {
  test.skip(!hasSession, "No auth state — set TEST_EMAIL/TEST_PASSWORD before running.");

  for (const route of ADMIN_ROUTES) {
    test(`${route.name} (${route.path})`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "networkidle" });
      // Bail out early if auth bounced us back to /auth or /device-verify.
      if (/\/(auth|device-verify)/.test(new URL(page.url()).pathname)) {
        test.skip(true, `Redirected to ${page.url()} — session not valid for ${route.path}`);
      }
      await page.evaluate(() => (document as any).fonts?.ready);
      await expect(page).toHaveScreenshot(`${route.name}.png`, {
        fullPage: true,
      });
    });
  }
});