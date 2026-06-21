import { chromium, type FullConfig } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Logs in once and persists Supabase session + trusted device hash to
 * tests/visual/.auth/user.json so admin specs can reuse the session.
 *
 * Required env:
 *   TEST_EMAIL     - existing test user email
 *   TEST_PASSWORD  - test user password
 *
 * Optional env:
 *   BASE_URL                - defaults to http://localhost:5173
 *   TEST_DEVICE_BYPASS=1    - set if your backend exposes a way to mark
 *                             the device as trusted automatically.
 *
 * If TEST_EMAIL/TEST_PASSWORD are missing the setup writes an empty
 * storage state so admin tests will fail fast with a clear message.
 */
const STORAGE = "tests/visual/.auth/user.json";

export default async function globalSetup(config: FullConfig) {
  await mkdir(dirname(STORAGE), { recursive: true });
  const baseURL = process.env.BASE_URL ?? "http://localhost:5173";
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;

  if (!email || !password) {
    console.warn(
      "[visual] TEST_EMAIL / TEST_PASSWORD not set — admin specs will be skipped.",
    );
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    await ctx.storageState({ path: STORAGE });
    await browser.close();
    return;
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await page.goto("/auth");
  await page.getByPlaceholder("alamat@email.com").fill(email);
  await page.getByPlaceholder(/Kata sandi/).first().fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30_000 }),
    page.getByRole("button", { name: "Masuk" }).click(),
  ]);
  // If redirected to /device-verify, the test environment must provide a
  // pre-trusted device — log a hint and continue so the state is captured.
  if (page.url().includes("/device-verify")) {
    console.warn(
      "[visual] Landed on /device-verify after login — trust this device once manually,",
      "or expose a TEST_DEVICE_BYPASS in your backend, then re-run.",
    );
  }
  await ctx.storageState({ path: STORAGE });
  await browser.close();
}