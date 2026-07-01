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
      // E2E scroll-guard sidebar: verifikasi tap navigation dibatalkan
      // selama gesture scroll aktif (mobile touch + desktop wheel).
      // Harness self-contained via page.setContent — tidak butuh auth.
      name: "sidebar-scroll-guard-e2e",
      testDir: "./tests/e2e",
      testMatch: /sidebar-scroll-guard\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // E2E form validasi minSupported (Pengaturan APK). Harness publik
      // di /lovable/visual/min-supported-form — no-auth. Menguji pesan
      // inline per-field, banner form-level, dan teks toast sukses/error.
      name: "apk-min-validate-form-e2e",
      testDir: "./tests/e2e",
      testMatch: /apk-min-validate-form\.spec\.ts/,
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
    {
      // E2E visibilitas menu admin. Harness publik no-auth memverifikasi
      // (a) `filterSidebarItemsForAdmin` menyembunyikan `/pengaturan-apk`
      // & `/email-queue` dari non-admin, (b) klasifikasi halaman APK
      // jatuh ke "notice" tanpa crash, dan (c) tidak ada request ke
      // server-fn admin dari halaman ini.
      name: "admin-visibility-e2e",
      testDir: "./tests/e2e",
      testMatch: /admin-visibility\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      // E2E RLS/GRANT: pastikan role `authenticated` bisa SELECT
      // `message_hidden` + memanggil RPC `message_hide_for_me` tanpa
      // permission denied. Butuh storage state hasil global-setup;
      // spec akan self-skip kalau storage kosong.
      name: "message-hidden-rls-e2e",
      testDir: "./tests/e2e",
      testMatch: /message-hidden-rls\.spec\.ts/,
      use: {
        ...devices["iPhone 14"],
        viewport: { width: 390, height: 844 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // Integrasi: pesan yang di-hide via RPC harus tetap hidden setelah
      // `page.reload()` — bukti persistence server + rehidrasi cache
      // `["chat","hidden"]` pada mount berikutnya. Butuh storage state.
      name: "message-hidden-persist-e2e",
      testDir: "./tests/e2e",
      testMatch: /message-hidden-persist\.spec\.ts/,
      use: {
        ...devices["iPhone 14"],
        viewport: { width: 390, height: 844 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // Kontrak positif: admin membuka tiap route admin harus MEMICU
      // server-fn yang sesuai (listApkReleaseAdminPanel, getEmailQueueStatus,
      // listAdminDenialEvents). Butuh storage state hasil global-setup;
      // self-skip bila user login bukan admin.
      name: "admin-routes-serverfn-called-e2e",
      testDir: "./tests/e2e",
      testMatch: /admin-routes-serverfn-called\.spec\.ts/,
      use: {
        ...devices["iPhone 14"],
        viewport: { width: 390, height: 844 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // Regresi RPC `add_contact_by_invite_code`: WHERE ab.linked_user_id
      // sudah di-qualify supaya tidak bentrok dengan OUT parameter. Spec
      // memanggil RPC dari konteks browser user login dengan PIN valid
      // dari user lain (dicari via psql) dan menegakkan error TIDAK
      // mengandung "ambiguous". Self-skip bila storageState kosong atau
      // tidak ada PIN target di DB.
      name: "undang-add-contact-rpc-e2e",
      testDir: "./tests/e2e",
      testMatch: /undang-add-contact-rpc\.spec\.ts/,
      use: {
        ...devices["iPhone 14"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
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
    // ── Daftar produk: 4 lebar Android umum untuk regresi wrap/overflow.
    //   320 = Galaxy Fold tertutup / iPhone 5-era
    //   360 = Android baseline (Samsung A-series default)
    //   411 = Pixel 6/7/8
    //   480 = phablet / phone landscape kelas bawah
    {
      name: "produk-list-320",
      testMatch: /produk-list\.public\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 320, height: 800 } },
    },
    {
      name: "produk-list-360",
      testMatch: /produk-list\.public\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 800 } },
    },
    {
      name: "produk-list-411",
      testMatch: /produk-list\.public\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
    },
    {
      name: "produk-list-480",
      testMatch: /produk-list\.public\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 480, height: 900 } },
    },
  ],
});