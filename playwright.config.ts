import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression configuration.
 *
 * - Tests run against an existing dev/preview server (default
 *   http://localhost:5173). Override with BASE_URL env.
 * - Snapshots compare with a small pixel tolerance to absorb font
 *   anti-aliasing differences across machines.
 * - Only mobile viewport (390x844) is tested per project requirements;
 *   add more projects below to extend coverage.
 */
export default defineConfig({
  testDir: "./tests/visual",
  snapshotDir: "./tests/visual/__screenshots__",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./tests/visual/global-setup.ts",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  },
  expect: {
    toHaveScreenshot: {
      // Tolerance is tuned to absorb cross-machine font hinting and
      // sub-pixel anti-aliasing without hiding real UI regressions.
      //
      // - `threshold` (0..1): per-pixel YIQ color distance. 0.2 ignores
      //   AA shading on glyph edges but still catches color/shape changes.
      // - `maxDiffPixelRatio`: cap on the share of pixels allowed to differ.
      //   ~1.5% absorbs font + scrollbar rendering drift between Linux CI
      //   and local macOS/Windows machines.
      // - `maxDiffPixels`: absolute floor so tiny screenshots aren't held
      //   to a stricter bar than large ones.
      //
      // Override per-call with `{ threshold, maxDiffPixelRatio, mask }` when
      // a specific surface needs different tolerance.
      threshold: 0.2,
      maxDiffPixelRatio: 0.015,
      maxDiffPixels: 150,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  projects: [
    {
      name: "mobile-public",
      testMatch: /public\.spec\.ts/,
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
    {
      // E2E fungsional portal pegawai (bukan visual regression).
      // Memakai mobile viewport karena pegawai mengakses lewat HP/APK.
      name: "worker-portal-e2e",
      testDir: "./tests/e2e",
      testMatch: /worker-portal-rehydrate\.spec\.ts/,
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
    {
      // E2E multi-tab: simulasi N tab same-origin menulis SYNC_KEY
      // bersamaan & verifikasi coalescing scheduler hanya melakukan 1
      // apply per jendela. Pakai desktop viewport karena uji ini tidak
      // bergantung form factor — hanya storage event lintas-page.
      name: "multi-tab-sync-e2e",
      testDir: "./tests/e2e",
      testMatch: /multi-tab-sync-coalesce\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // Tablet portrait — verifies PinnedBanner & conversation list
      // render consistently at iPad-class widths.
      name: "tablet-public",
      testMatch: /chat-deleted\.public\.spec\.ts/,
      use: { ...devices["iPad (gen 7)"], viewport: { width: 820, height: 1180 } },
    },
    {
      // Tablet landscape — wider list rows, banner stretches.
      name: "tablet-landscape-public",
      testMatch: /chat-deleted\.public\.spec\.ts/,
      use: {
        ...devices["iPad (gen 7) landscape"],
        viewport: { width: 1180, height: 820 },
      },
    },
    {
      name: "mobile-admin",
      testMatch: /admin\.spec\.ts/,
      use: {
        ...devices["iPhone 14"],
        viewport: { width: 390, height: 844 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      name: "sidebar-highlight",
      testMatch: /sidebar-highlight\.spec\.ts/,
      use: {
        ...devices["iPhone 14"],
        viewport: { width: 390, height: 844 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
  ],
});