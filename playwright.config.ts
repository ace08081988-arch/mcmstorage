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
  retries: process.env.PWTEST_RETRIES
    ? Number(process.env.PWTEST_RETRIES)
    : process.env.CI
      ? 1
      : 0,
  // Fail-fast opsional dari env — dipakai workflow `chat-pin-mcm-e2e.yml`
  // supaya regresi format PIN / kebocoran nomor telp segera menghentikan
  // run tanpa menunggu proyek lain. Default: tidak ada batas.
  maxFailures: process.env.PWTEST_MAX_FAILURES
    ? Number(process.env.PWTEST_MAX_FAILURES)
    : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    // Ringkasan tambahan yang mengelompokkan hasil spec APK menjadi
    // grup `terminalGuard-only` vs `full guards` di akhir run — aditif,
    // tidak menggantikan reporter lain. Klasifikasi berbasis isi file
    // spec (deteksi `installServerFnPassthroughGuard`).
    ["./tests/e2e/_helpers/apk-grouped-reporter.ts"],
  ],
  globalSetup: "./tests/visual/global-setup.ts",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:5173",
    // Debug artefak untuk regresi format PIN:
    //   - CI: trace + video + screenshot semuanya `retain-on-failure`
    //     sehingga tiap kegagalan (mis. token PIN off-format atau
    //     kebocoran nomor telp mentah) langsung bisa direplay dari
    //     artifact Playwright tanpa menunggu re-run lokal.
    //   - Lokal: hanya trace + screenshot on-failure — video di-skip
    //     supaya dev loop cepat & disk tidak penuh.
    // Override manual via `PWTEST_VIDEO=on|retain-on-failure|off`.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: (process.env.PWTEST_VIDEO as
      | "on"
      | "off"
      | "retain-on-failure"
      | undefined) ?? (process.env.CI ? "retain-on-failure" : "off"),
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    // Override biner Chromium untuk lingkungan sandbox/CI yang sudah
    // menyediakan browser sendiri (hemat unduhan). Kosong = default Playwright.
    ...(process.env.PWTEST_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PWTEST_CHROMIUM_PATH } }
      : {}),
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
      // Audit tap-target: setiap <Button> di harness
      // /lovable/visual/tap-targets harus ≥44px + gap ≥8px pada
      // breakpoint HP (Pixel 5, 411×893). Snapshot PNG dipakai untuk
      // menjaring regresi padding/gap yang lolos threshold numerik.
      name: "tap-targets",
      testMatch: /tap-targets\.public\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
    },
    {
      // Visual regression seluruh variasi menu (sidebar, bottom nav
      // utama, bottom nav chat, pill tabs) di mode terang & gelap.
      // Harness /lovable/visual/menu-variants memakai komponen asli,
      // jadi perubahan token tema/CSS yang membuat warna menu tidak
      // konsisten langsung menggagalkan snapshot + asersi token.
      name: "menu-variants",
      testMatch: /menu-variants\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
    },
    {
      // Render-guard halaman /pratinjau-tema: seluruh variasi komponen
      // (token, tombol, badge, link, sidebar item, pill tabs) harus
      // ter-render di mode terang & gelap tanpa error konsol.
      name: "pratinjau-tema",
      testMatch: /pratinjau-tema\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
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
      // E2E ambil foto (kamera) + pilih dari galeri di `/t/:token`:
      // regresi guard supaya thumbnail dan PhotoEditor selalu tampil
      // setelah `setInputFiles` pada input tersembunyi kamera/galeri.
      // Mobile viewport (Pixel 5, 411x893) karena pegawai lewat APK.
      name: "worker-portal-pick-photo-e2e",
      testDir: "./tests/e2e",
      testMatch: /worker-portal-pick-photo\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
    },
    {
      // E2E alur kamera → editor → kembali tanpa reload di `/t/:token`.
      // Regresi guard hardening 5 Juli 2026: mekanisme `__mcmBusy` +
      // build-cache-buster harus mencegah reload selama pegawai mengedit
      // foto, dan seluruh state (thumbnail, sesi PIN) harus tetap ada.
      name: "worker-portal-camera-no-reload-e2e",
      testDir: "./tests/e2e",
      testMatch: /worker-portal-camera-no-reload\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
    },
    {
      // E2E regresi 6 Juli 2026: panel ItemCard yang dibuka manual tidak
      // boleh auto-kolaps saat `silentRefresh` berkala mengembalikan data
      // sama, dan PhotoEditor harus konsisten terbuka untuk tiap foto
      // saat user memilih beberapa foto dari galeri (queue urut).
      // Mobile viewport (Pixel 5, 411x893) karena pegawai akses via APK.
      name: "worker-portal-panel-photoedit-e2e",
      testDir: "./tests/e2e",
      testMatch: /worker-portal-panel-photoedit\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
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
      // Skenario : Bilah bawah (MobileBottomNav) harus selalu "snap" ke
      //            dasar layar saat scroll, pindah halaman, dan saat
      //            konten dinamis bertambah.
      // Harness  : /lovable/visual/bottom-bar-snap (publik, no-auth) —
      //            memakai komponen bottom nav asli.
      // Tujuan   : Regresi guard untuk `.app-static-bottom-bar`,
      //            use-viewport-anchor, dan spacer otomatis (ancestor
      //            ber-`filter`/`transform` membuat fixed ikut menggulir).
      name: "bottom-bar-snap-e2e",
      testDir: "./tests/e2e",
      testMatch: /bottom-bar-snap\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
    },
    {
      // Breakpoint tablet (768x1024). Bilah bawah `md:hidden`, jadi yang
      // dijaga di sini: bar TIDAK tampil dan `--app-bottom-bar-space`
      // tetap 0 (tidak ada ruang kosong sisa) di semua skenario.
      name: "bottom-bar-snap-e2e-tablet",
      testDir: "./tests/e2e",
      testMatch: /bottom-bar-snap\.spec\.ts/,
      // Pakai basis Chromium (bukan preset iPad/WebKit) supaya konsisten
      // dengan proyek lain & override PWTEST_CHROMIUM_PATH tetap berlaku.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
        isMobile: false,
        hasTouch: true,
      },
    },
    {
      // Breakpoint desktop (1280x800) — invarian sama dengan tablet.
      name: "bottom-bar-snap-e2e-desktop",
      testDir: "./tests/e2e",
      testMatch: /bottom-bar-snap\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // Aksesibilitas keyboard bilah bawah: Tab menjangkau semua slot,
      // cincin :focus-visible ada, Enter membuka menu, dan fokus tidak
      // hilang/dicuri saat scroll, pindah halaman, atau konten bertambah.
      name: "bottom-bar-keyboard-e2e",
      testDir: "./tests/e2e",
      testMatch: /bottom-bar-keyboard\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
    },
    {
      // Visual regression (screenshot diff) bilah bawah: strip 140px
      // paling bawah layar dibandingkan ke SATU baseline yang sama di
      // semua skenario (muat awal, scroll, pindah halaman, konten
      // dinamis, rotasi). Pergeseran sekecil apa pun langsung gagal.
      name: "bottom-bar-snap-visual",
      testMatch: /bottom-bar-snap\.visual\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
    },
    {
      // Skenario : Toast "Perbaiki Akses" muncul saat error akses
      //            ditolak (42501 / PGRST301 / 401 / 403) dan tombolnya
      //            memicu navigasi ke `/profil`. Error non-akses (mis.
      //            23505) TIDAK menampilkan tombol.
      // Harness  : /lovable/visual/access-denied-toast (publik, no-auth).
      // Tujuan   : Regresi guard supaya pengguna yang kena RLS tidak
      //            terdampar tanpa jalan keluar — selalu ada CTA ke
      //            halaman upgrade akun.
      name: "access-denied-toast-e2e",
      testDir: "./tests/e2e",
      testMatch: /access-denied-toast\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
    },
    {
      // Skenario : Batal auto-Kirim (AutoSendConfirmDialog) TIDAK PERNAH
      //            membuka dialog verifikasi pembayaran dan tidak memicu
      //            request pembayaran/penjualan (sales, customer_payment,
      //            record_sale, wa.me, dsb).
      // Harness  : /lovable/visual/auto-send-cancel (publik, no-auth) —
      //            memakai AutoSendConfirmDialog + AutoSendCancelReasonDialog
      //            yang sama dengan halaman /ecer, jadi non-tautological.
      // Tujuan   : Regresi guard supaya jalur Batal tidak pernah bocor
      //            ke pembayaran (mis. someone wiring setSendOpen(true)
      //            ke onCancel) dan tidak ada RPC penjualan / share WA
      //            yang menyelinap sebelum owner memberi konfirmasi.
      name: "auto-send-cancel-no-payment-e2e",
      testDir: "./tests/e2e",
      testMatch: /ecer-auto-send-cancel-no-payment\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
    },
    {
      // Skenario : Badge "Aktif" & "Terkirim" di surface Request + Ecer
      //            selalu konsisten dengan angka helper selector
      //            (`countActiveByTitle` + `filterSentPreps`) setelah
      //            transisi Tandai/Batalkan Terkirim.
      // Harness  : /lovable/visual/ready-badges-selector (publik, no-auth).
      // Tujuan   : Regresi guard supaya pipeline state → helper → badge
      //            tidak pernah bocor (mis. copy-paste literal `!!sold_at`
      //            di kartu baru) — bila badge tidak match, spec gagal.
      name: "ready-badges-selector-e2e",
      testDir: "./tests/e2e",
      // Cakup spec sibling yang memakai harness yang sama
      // (`/lovable/visual/ready-badges-selector`), mis.
      // `ecer-send-wa-riwayat.spec.ts` — regresi UI refresh badge +
      // pindah Riwayat Terkirim setelah "Kirim WA" pada dialog pembayaran.
      testMatch: /(ready-badges-selector|ecer-send-wa-riwayat|ecer-send-wa-partial|ecer-send-wa-message-content|ecer-send-wa-location|ecer-send-wa-note-encoding|ecer-send-wa-note-no-dup|ecer-send-wa-sent-locked|ecer-send-wa-message-order|ecer-send-wa-status-dibayar-sisa|ecer-send-wa-single-button-href|ecer-send-wa-catatan-order|ecer-return-from-wa|worker-shot-marksent-riwayat|two-user-drafts)\.spec\.ts/,
      // Debug artefak per-proyek: pertahankan trace + screenshot + video
      // untuk setiap attempt yang gagal (baik run awal maupun retry).
      // Playwright `retain-on-failure` merekam trace penuh tiap test dan
      // menyimpannya hanya jika attempt tersebut gagal — jadi kegagalan
      // pertama DAN tiap retry yang masih gagal terekam lengkap.
      // Retries di-force ≥1 supaya minimal ada satu retry di lokal juga
      // (CI sudah default 1 via env). Override manual via PWTEST_RETRIES.
      retries: process.env.PWTEST_RETRIES
        ? Number(process.env.PWTEST_RETRIES)
        : 1,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
      },
    },
    {
      // Skenario : Form validasi `minSupported` di Pengaturan APK.
      // Harness  : /lovable/visual/min-supported-form (publik, no-auth).
      // Tujuan   : Membuktikan pesan inline per-field, banner form-level,
      //            dan teks toast sukses/error muncul sesuai state input.
      // Guards   : (spec form murni — bukan flow getApkVariantDetail,
      //            tidak memakai apk-stub / terminalGuard).
      name: "apk-min-validate-form-e2e",
      testDir: "./tests/e2e",
      testMatch: /apk-min-validate-form\.spec\.ts/,
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
    {
      // Skenario : Tombol pintas Pengaturan — alur idle "Belum tersedia"
      //            → tap ikon refresh varian Chat → state aktif
      //            "Unduh APK Chat".
      // Harness  : /lovable/visual/apk-availability-shortcuts (no-auth),
      //            `getApkVariantDetail` di-stub via installApkStub.
      // Tujuan   : Membuktikan tap refresh Chat memicu tepat satu refetch
      //            dan cross-variant Storage tidak terpengaruh.
      // Guards   : ✓ primeInitial + assertPrimed  ✓ waitForServed
      //            ✓ trackedClick(expected.chat=1)  ✓ assertQuiescent
      //            ✓ terminalGuard()  (mode: terminal)
      name: "apk-availability-refresh-e2e",
      testDir: "./tests/e2e",
      testMatch: /apk-availability-refresh\.spec\.ts/,
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
    {
      // Skenario : Tombol <DownloadStorageApkShortcut> — idle "Belum
      //            tersedia" → tap ikon refresh Storage → aktif
      //            "Unduh APK Storage". Hanya flag Storage di-flip;
      //            flag Chat sengaja dibiarkan kosong.
      // Harness  : /lovable/visual/apk-availability-shortcuts (no-auth),
      //            `getApkVariantDetail` di-stub via installApkStub.
      // Tujuan   : Membuktikan independensi query per-varian — refetch
      //            Storage TIDAK menyeret varian Chat / tombol copy.
      // Guards   : ✓ primeInitial + assertPrimed  ✓ waitForServed
      //            ✓ trackedClick(expected.storage=1)  ✓ assertQuiescent
      //            ✓ terminalGuard()  (mode: terminal)
      name: "apk-availability-refresh-storage-e2e",
      testDir: "./tests/e2e",
      testMatch: /apk-availability-refresh-storage\.spec\.ts/,
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
    {
      // Skenario : Tap refresh Storage sekali → observasi servedCount &
      //            request count untuk kedua varian.
      // Harness  : /lovable/visual/apk-availability-shortcuts (no-auth).
      // Tujuan   : Regression guard — SATU tap = SATU refetch (bukan 2),
      //            tidak ada polling background / refetch-on-focus.
      // Guards   : ✓ primeInitial + assertPrimed  ✓ waitForServed
      //            ✓ trackedClick(expected.storage=1)  ✓ assertQuiescent
      //            ✓ terminalGuard()  (mode: terminal)
      name: "apk-refresh-single-refetch-e2e",
      testDir: "./tests/e2e",
      testMatch: /apk-refresh-single-refetch\.spec\.ts/,
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
    {
      // E2E aria-label per state pada <CopyChatApkLinksButton>: idle
      // (belum tersedia), disabled (checking / busy), dan aktif
      // (tersalin). Harness publik /lovable/visual/apk-availability-shortcuts
      // dengan gate stub server-fn agar setiap fase state bisa
      // diobservasi sebelum data masuk. Butuh izin clipboard untuk
      // memvalidasi transisi busy → tersalin.
      name: "copy-chat-apk-aria-label-e2e",
      testDir: "./tests/e2e",
      testMatch: /copy-chat-apk-aria-label\.spec\.ts/,
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
    {
      // Skenario : Mount murni — buka
      //            /lovable/visual/apk-availability-shortcuts dengan
      //            kedua varian merespons kosong; tidak ada aksi user.
      // Harness  : /lovable/visual/apk-availability-shortcuts (no-auth),
      //            `getApkVariantDetail` di-stub via installApkStub.
      // Tujuan   : Buktikan tidak ada request tambahan setelah fetch
      //            awal — no polling, no refetch-on-focus, no interval.
      // Referensi: contoh hasil salin dari
      //            `tests/e2e/_helpers/apk-spec.template.ts`.
      // Guards   : ✓ primeInitial + assertPrimed  ✓ waitForServed
      //            (tidak ada trackedClick — mount-only)
      //            ✓ assertQuiescent  ✓ terminalGuard()  (mode: terminal)
      name: "apk-mount-quiescent-e2e",
      testDir: "./tests/e2e",
      testMatch: /apk-mount-quiescent\.spec\.ts/,
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
    {
      // Skenario : Mount kedua varian kosong → refetch Chat via
      //            trackedClick → state aktif "Unduh APK Chat".
      // Harness  : /lovable/visual/apk-availability-shortcuts (no-auth).
      // Tujuan   : Contoh pembanding — buktikan `terminalGuard()` saja
      //            (tanpa `installServerFnPassthroughGuard`) SUDAH CUKUP
      //            untuk flow APK murni yang tidak menyentuh server
      //            function di luar `getApkVariantDetail`.
      // Referensi: bandingkan dengan spec `--mode full` untuk melihat
      //            selisih setup passthrough guard.
      // Guards   : ✓ primeInitial + assertPrimed  ✓ waitForServed
      //            ✓ trackedClick(expected.chat=1)  ✓ assertQuiescent
      //            ✓ terminalGuard()  (mode: terminal)
      name: "apk-example-terminal-only-e2e",
      testDir: "./tests/e2e",
      testMatch: /apk-example-terminal-only\.spec\.ts/,
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
    {
      // E2E konsistensi label /diagnostik/paket: memverifikasi bahwa
      // "Isi / kemasan", "Harga per", dan "Ringkasan · yang tersedia"
      // SELALU konsisten dengan pilihan dropdown Jenis kemasan
      // (gram / botol / pcs) — baik setelah impor payload maupun
      // setelah mengganti dropdown pasca impor. Halaman publik no-auth.
      name: "diagnostik-paket-label-consistency-e2e",
      testDir: "./tests/e2e",
      testMatch: /diagnostik-paket-label-consistency\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // E2E banner mismatch di /diagnostik/paket: memverifikasi
      // `diag-mismatch` muncul saat payload mengandung override display
      // yang menyimpang dari derived (mis. displayBaseUnitOverride="pcs"
      // padahal effBaseUnit="g"), lalu hilang setelah impor payload
      // benar (override direset ke null).
      name: "diagnostik-paket-mismatch-banner-e2e",
      testDir: "./tests/e2e",
      testMatch: /diagnostik-paket-mismatch-banner\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // E2E banner mismatch reaktif terhadap dropdown pasca impor:
      // memverifikasi banner `diag-mismatch` / `diag-ok` MUNCUL & HILANG
      // dengan benar saat user mengubah dropdown `mode` atau `priceMode`
      // setelah payload impor — bukan hanya saat impor ulang. Halaman
      // publik no-auth.
      name: "diagnostik-paket-mismatch-dropdown-e2e",
      testDir: "./tests/e2e",
      testMatch: /diagnostik-paket-mismatch-dropdown\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // E2E sinkronisasi state /diagnostik/paket: setelah impor payload
      // benar, `packageType` (dropdown form), `displayPackageType`, dan
      // `displayBaseUnit` HARUS sesuai value yang diharapkan untuk tiap
      // varian (gram / botol / pcs / sachet, mode new & existing).
      name: "diagnostik-paket-state-sync-e2e",
      testDir: "./tests/e2e",
      testMatch: /diagnostik-paket-state-sync\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // E2E konversi karton di kolom Stok gudang: harness publik
      // `/lovable/visual/karton-konversi` merender `fmtItemQty` — sama
      // dengan yang dipakai kartu Stok di /gudang. Test menegakkan bahwa
      // 100 botol otomatis tampil sebagai "1 karton", plus batas 99/250/500
      // dan negatif-case gram (tidak boleh muncul hint karton).
      name: "karton-konversi-stok-e2e",
      testDir: "./tests/e2e",
      testMatch: /karton-konversi-stok\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // E2E hint & badge breakdown konversi kemasan di /gudang.
      // Harness publik `/lovable/visual/kemasan-badge` merender
      // <KemasanRumusPopover> + <KemasanKonversiBadge> + fmtItemQty
      // dengan payload yang sama. Test menegakkan (a) teks hint
      // "1 karton = 100 botol" muncul di popover, (b) badge karton
      // menampilkan `N karton = N×100 botol`, dan (c) angka botol pada
      // badge konsisten dengan `fmtItemQty(N×100 botol)` di kolom Stok.
      name: "kemasan-badge-hint-e2e",
      testDir: "./tests/e2e",
      testMatch: /kemasan-badge-hint\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
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
      // Regresi Buku Alamat: dua kontak dengan NAMA sama tapi NOMOR
      // berbeda harus tetap bisa disimpan (indeks unik parsial hanya
      // melarang duplikat nomor/email), dengan toast "Kontak berhasil
      // diperbarui". Nomor identik (termasuk variasi +62/08) tetap
      // diblokir. Login otomatis lewat global-setup; dengan
      // PWTEST_REQUIRE_AUTH=1 spec gagal (bukan skip) bila sesi kosong.
      name: "buku-alamat-nama-kembar-e2e",
      testDir: "./tests/e2e",
      testMatch: /buku-alamat-same-name-different-phone\.spec\.ts/,
      use: {
        // Pakai basis Chromium (bukan iPhone/WebKit) supaya konsisten
        // dengan proyek lain & override PWTEST_CHROMIUM_PATH berlaku.
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
        // Artefak lengkap saat gagal: screenshot + video + trace, supaya
        // penyebab "tombol Simpan tidak bekerja" (toast error, dialog
        // yang tidak tertutup) bisa dilacak langsung dari laporan.
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        trace: "retain-on-failure",
      },
    },
    {
      // E2E chat surface: guard bahwa nomor telepon TIDAK muncul sebagai
      // fallback identitas — semua permukaan chat memakai `PIN xxxx-xxxx`.
      // Static source guard selalu jalan; blok runtime (buka `/chat`,
      // dialog "Chat baru", buka DM & kirim pesan) self-skip bila
      // storageState kosong.
      name: "chat-pin-mcm-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: memulai DM dari halaman daftar kontak (`/kontak` &
      // `/buku-alamat`) bukan dari `/chat`. Source guard mengunci wiring
      // `startDm.mutateAsync` + `navigate(/chat/$conversationId)` supaya
      // pesan mendarat di percakapan yang benar; runtime memverifikasi
      // dialog "Chat baru" tetap memakai placeholder PIN Ace.
      name: "chat-pin-mcm-from-kontak-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-from-kontak\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: pagination / load-more di transkrip chat wajib terus
      // menampilkan `PIN xxxx-xxxx` sebagai identitas peer dan TIDAK
      // memunculkan nomor telp mentah pada setiap wave scroll. Static
      // source guard memaksa query `messages` tidak menarik kolom phone
      // & memakai batas eksplisit; runtime self-skip bila storage/DM
      // belum tersedia.
      name: "chat-pin-mcm-pagination-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-pagination\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: kirim pesan berlampiran di DM pertama harus mempertahankan
      // identitas `PIN xxxx-xxxx` di header + transkrip + sheet Lampirkan
      // — tidak boleh mem-fallback ke nomor telepon peer. Static source
      // guard selalu jalan; runtime self-skip bila storageState kosong
      // atau akun test belum punya DM.
      name: "chat-pin-mcm-attachment-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-attachment\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: DM yang sudah ada tetap memakai identitas `PIN xxxx-xxxx`
      // dan histori pesan tetap terbaca setelah `page.reload()` — bukti
      // useConversationMessages mem-fetch dari server via useQuery,
      // bukan sekadar bertahan lewat state realtime. Static source
      // guard selalu jalan; runtime self-skip bila storageState kosong
      // atau akun test belum punya DM/pesan.
      name: "chat-pin-mcm-existing-dm-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-existing-dm\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: berpindah antar DM yang sudah ada — header & transkrip
      // tiap konvo memakai `PIN xxxx-xxxx` peer yang benar, identitas
      // tidak "menyangkut" dari DM sebelumnya, dan tidak ada nomor
      // telp mentah pada tiap fase (DM A → DM B → balik ke DM A).
      name: "chat-pin-mcm-switch-dm-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-switch-dm\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: perpindahan antar DM lewat sidebar/daftar percakapan
      // (`/chat`). Setiap klik item DM harus me-render `PIN xxxx-xxxx`
      // peer yang benar di header & transkrip, tanpa "menyangkut" dari
      // DM sebelumnya dan tanpa nomor telp mentah di semua fase.
      name: "chat-pin-mcm-switch-via-list-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-switch-via-list\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: setelah `page.reload()` di DM yang sudah ada, mengirim
      // pesan baru wajib tetap merender identitas `PIN xxxx-xxxx` di
      // header & transkrip — tidak pernah mem-fallback ke nomor telp
      // mentah. Reload kedua memastikan pesan baru bertahan (bukan
      // sekadar bubble optimistik) dan branding tetap konsisten.
      name: "chat-pin-mcm-post-refresh-send-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-post-refresh-send\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: membuka DM lewat DEEP LINK `/chat/$conversationId` langsung
      // (tanpa transit `/chat`, konteks bersih) wajib merender identitas
      // `PIN xxxx-xxxx` di header & transkrip; setelah `reload()` histori
      // pra-reload tetap terbaca — bukti hidrasi dari server per-konvo,
      // bukan sisa cache list.
      name: "chat-pin-mcm-deep-link-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-deep-link\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: deep link multi-DM — `page.goto('/chat/<idA>')` diikuti
      // `page.goto('/chat/<idB>')` (langsung, tanpa transit daftar),
      // lalu balik ke `<idA>`. Setiap kunjungan wajib menampilkan
      // `PIN xxxx-xxxx` peer yang benar di header + transkrip dan
      // BEBAS nomor telp Indonesia mentah; identitas peer A ≠ peer B.
      name: "chat-pin-mcm-deep-link-multi-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-deep-link-multi\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: kirim pesan baru di DM eksisting → scroll ke atas berkali
      // untuk memicu load-more. Setiap wave pagination wajib
      // mempertahankan `PIN xxxx-xxxx` di header + transkrip dan
      // BEBAS nomor telp Indonesia mentah. Source guard mengunci
      // `useConversationMessages` untuk tidak SELECT kolom `phone`.
      name: "chat-pin-mcm-send-then-loadmore-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-send-then-loadmore\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: setelah `reload()` di DM eksisting, aksi Salin (Copy) via
      // SelectionToolbar menghasilkan payload clipboard yang BEBAS
      // nomor telp Indonesia mentah — hanya body pesan / `PIN xxxx-xxxx`.
      // Static guard mengunci handler `onCopy` di chat.$conversationId
      // memakai `safePreview` (= `messagePreviewText`) dan tidak
      // menyentuh `.phone`.
      name: "chat-pin-mcm-copy-export-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-copy-export\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: preview baris DM di halaman daftar `/chat` — judul peer,
      // snippet pesan terakhir, dan aria-label wajib memakai
      // `PIN xxxx-xxxx` dan BEBAS nomor telp Indonesia mentah, dengan
      // konsistensi bertahan sebelum & sesudah `reload()`. Source guard
      // mengunci `chat.index` memakai `<Link to="/chat/$conversationId">`
      // tanpa fallback `.phone` sebagai teks tampilan.
      name: "chat-pin-mcm-list-preview-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-list-preview\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: setelah `reload()` pada DM eksisting, meng-Edit pesan
      // sendiri (menu bubble → Edit → ubah body → simpan) wajib
      // mempertahankan `PIN xxxx-xxxx` di header + transkrip dan label
      // "diedit" muncul pada bubble hasil edit, tanpa nomor telp
      // Indonesia mentah — konsisten juga setelah reload kedua.
      name: "chat-pin-mcm-edit-message-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-edit-message\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: fitur "Cari di percakapan" pada DM yang sudah ada — dialog,
      // list hits, header, dan transkrip di belakang dialog wajib memakai
      // `PIN xxxx-xxxx` dan bebas nomor telp Indonesia mentah. Source
      // guard memastikan `ConversationSearchDialog` hanya membaca
      // `m.body`/`m.created_at`, tidak `m.phone`.
      name: "chat-pin-mcm-search-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-search\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
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
    // ── Baris tombol lokasi worker (input Link Maps + GPS + Tempel).
    //   Regresi clipping/overflow saat viewport sempit 390 (iPhone 12/13/14)
    //   dan 411 (Pixel 6/7/8). Fixture: /lovable/visual/prep-loc-buttons.
    {
      name: "prep-loc-buttons-390",
      testMatch: /prep-loc-buttons\.public\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "prep-loc-buttons-411",
      testMatch: /prep-loc-buttons\.public\.spec\.ts/,
      use: { ...devices["Pixel 5"], viewport: { width: 411, height: 893 } },
    },
    {
      // E2E: navigasi browser back/forward antar dua DM eksisting wajib
      // mempertahankan `PIN xxxx-xxxx` yang benar per konvo di header +
      // transkrip dan tidak pernah memunculkan nomor telp Indonesia
      // mentah pada fase pra-nav, back, maupun forward.
      name: "chat-pin-mcm-back-forward-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-back-forward\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: deep link `/chat/<uuid>` yang tidak ada / tidak berizin
      // wajib menampilkan banner "Percakapan tidak ditemukan"
      // (role="alert", data-testid="chat-not-found") dengan CTA balik
      // ke `/chat`, dan bebas nomor telp Indonesia mentah pada banner
      // maupun body halaman.
      name: "chat-pin-mcm-invalid-deep-link-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-invalid-deep-link\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: fuzz PIN Ace lintas hingga 5 DM acak — header + transkrip
      // wajib bebas nomor telp Indonesia mentah pada fase awal, setelah
      // reload, dan setelah scroll load-more; setiap token "PIN <...>"
      // yang tampil wajib berformat `xxxx-xxxx`; identitas antar konvo
      // berbeda wajib unik.
      name: "chat-pin-mcm-random-multi-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-random-multi\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: DM ke peer tanpa PIN lengkap (invite_code kosong / <4
      // karakter, tanpa display_name & email, walau kolom phone terisi)
      // wajib menampilkan placeholder aman ("Kontak" atau alias) di
      // header dan bebas nomor telp Indonesia mentah di header maupun
      // transkrip. RPC `get_chat_member_profiles` diintercept & di-
      // rewrite di runtime untuk memaksa skenario ini.
      name: "chat-pin-mcm-incomplete-pin-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-incomplete-pin\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // Smoke test murni untuk helper `tests/e2e/_helpers/chat-pin-assertions.ts`
      // — mengunci kontrak regex `PHONE_ID_LIKE`, `PIN_MCM_FORMAT`, dan
      // perilaku `expectNoRawPhone` / `expectPinFormat` / `expectPinBrandingClean`
      // yang dipakai seluruh suite `chat-pin-mcm-*`. Tidak butuh dev server.
      name: "chat-pin-assertions-helper-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-assertions-helper\.smoke\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    // ── Multi-viewport: skenario buka DM eksisting pertama dijalankan
    //   ulang di 3 lebar (mobile 411, tablet 820, desktop 1280) untuk
    //   membuktikan branding `PIN xxxx-xxxx` tidak regres di breakpoint
    //   manapun (list, header, transkrip). Spec sama, viewport beda.
    {
      name: "chat-pin-mcm-multi-viewport-mobile-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-multi-viewport\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      name: "chat-pin-mcm-multi-viewport-tablet-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-multi-viewport\.spec\.ts/,
      use: {
        ...devices["iPad (gen 7)"],
        viewport: { width: 820, height: 1180 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      name: "chat-pin-mcm-multi-viewport-desktop-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-multi-viewport\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: variasi input PIN di FAB "Tambah kontak PIN" halaman /chat
      // — lowercase / spasi berlebih / dash salah / kelebihan karakter
      // wajib DINORMALISASI menjadi `XXXX-XXXX` oleh handler onChange
      // (memakai `normalizeInviteCode`), dan seluruh dialog tetap bebas
      // nomor telp Indonesia mentah. Static source guard + unit
      // formatInviteCode selalu jalan; blok runtime self-skip bila
      // storageState kosong.
      name: "chat-pin-mcm-input-variations-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-input-variations\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: buka beberapa DM eksisting bergantian, tiap DM di-reload
      // berulang kali. Identitas header WAJIB persist antar reload,
      // identitas antar DM berbeda WAJIB unik, dan header + transkrip
      // tidak pernah menampilkan nomor telp Indonesia mentah (semua
      // token `PIN <...>` mengikuti format `xxxx-xxxx`).
      name: "chat-pin-mcm-multi-reload-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-multi-reload\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: full-coverage sweep — buka SETIAP DM dari daftar `/chat`,
      // baca innerText body-nya, dan pastikan (a) tidak ada substring
      // nomor telp Indonesia mentah di halaman mana pun, (b) SETIAP
      // token `PIN …` yang tampil lolos `PIN_MCM_FORMAT`
      // (`PIN xxxx-xxxx`). Berbeda dari suite sampling: pelanggaran
      // dikumpulkan lalu dilaporkan sekaligus.
      name: "chat-pin-mcm-all-dms-body-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-all-dms-body\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: variasi deep link `/chat/<id>` invalid — UUID nihil, UUID
      // acak tanpa izin (RLS), dan slug non-UUID. Tiap varian wajib:
      // menampilkan banner `chat-not-found`, bebas nomor telp Indonesia
      // mentah, tidak memuat token `PIN …` off-format, tidak membocorkan
      // raw id di banner, dan CTA "Kembali ke daftar chat" balik ke /chat.
      name: "chat-pin-mcm-invalid-deep-link-variants-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-invalid-deep-link-variants\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    // ── Lintas-browser: skenario PIN Ace inti dijalankan di Chromium,
    //   Firefox, dan WebKit untuk memastikan hasil rendering `PIN
    //   xxxx-xxxx` konsisten dan bebas nomor telp mentah di ketiga
    //   engine (perbedaan normalisasi innerText, whitespace, dan
    //   fallback font tidak boleh memicu regresi).
    {
      name: "chat-pin-mcm-cross-browser-chromium-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-cross-browser\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      name: "chat-pin-mcm-cross-browser-firefox-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-cross-browser\.spec\.ts/,
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1280, height: 900 },
        storageState: "tests/visual/.auth/user.json",
        trace: "on",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
      },
    },
    {
      name: "chat-pin-mcm-cross-browser-webkit-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-cross-browser\.spec\.ts/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1280, height: 900 },
        storageState: "tests/visual/.auth/user.json",
        trace: "on",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
      },
    },
    {
      // E2E: kombinasi back/forward + reload antar DM eksisting.
      // Setiap checkpoint history (A, B, back→A, forward→B) di-reload
      // untuk memastikan rehidrasi cache + Route.useParams() tidak
      // menyisakan identitas peer sebelumnya, tetap `PIN xxxx-xxxx`,
      // dan bebas nomor telp Indonesia mentah.
      name: "chat-pin-mcm-back-forward-reload-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-back-forward-reload\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: rotasi orientasi portrait↔landscape antar DM + reload.
      // Menguji layout responsif dan rehidrasi setelah setViewportSize
      // — identitas peer tidak boleh flip ke nomor telp mentah, token
      // PIN wajib tetap berformat `xxxx-xxxx` di kedua orientasi.
      name: "chat-pin-mcm-orientation-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-orientation\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: scroll-up load-more berulang di transkrip DM + reload
      // berkali-kali. Wave pagination + rehidrasi cache TanStack Query
      // wajib mempertahankan `PIN xxxx-xxxx` di header/transkrip dan
      // BEBAS nomor telp Indonesia mentah pada setiap fase.
      name: "chat-pin-mcm-loadmore-reload-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-loadmore-reload\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: reload berkali-kali di bawah throttling Slow 3G pada
      // beberapa DM. Selama fase loading/skeleton, `innerText` di-poll
      // untuk memastikan nomor telp Indonesia mentah TIDAK PERNAH
      // muncul (bahkan satu frame). Setelah stabil, identitas peer
      // wajib berformat `PIN xxxx-xxxx`. Throttling via CDP → hanya
      // Chromium (non-Chromium self-skip).
      name: "chat-pin-mcm-throttled-reload-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-throttled-reload\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: simulasi OFFLINE lalu kembali ONLINE pada beberapa DM.
      // Reload di kondisi offline tidak boleh membocorkan nomor telp
      // Indonesia mentah (cache basi), dan setelah reconnect identitas
      // peer wajib berformat `PIN xxxx-xxxx` — konsisten dengan baseline
      // online sebelumnya. Emulasi offline via CDP → hanya Chromium.
      name: "chat-pin-mcm-offline-reconnect-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-offline-reconnect\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: reload berkali-kali di bawah throttling REGULAR 2G
      // (~250 kbps, RTT 800ms) — lebih lambat dari Slow 3G. Fase
      // skeleton lebih panjang → window kebocoran lebih besar; test
      // mem-poll `innerText` tiap ~100ms dan gagal seketika bila
      // `PHONE_ID_LIKE` cocok, lalu mengunci kontrak `PIN xxxx-xxxx`
      // setelah stabil. CDP-only → hanya Chromium.
      name: "chat-pin-mcm-2g-throttled-reload-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-2g-throttled-reload\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: konsistensi format `PIN xxxx-xxxx` LINTAS PERMUKAAN UI
      // (daftar percakapan `/chat`, header DM, panel detail transkrip)
      // selama reload biasa DAN transisi jaringan (offline↔online,
      // throttled Slow 3G↔normal). Token PIN peer yang tampil di
      // daftar wajib identik dengan yang tampil di header & panel
      // detail, dan tetap stabil pasca-transisi jaringan. CDP untuk
      // offline/throttle → non-Chromium hanya menjalankan fase online.
      name: "chat-pin-mcm-cross-surface-consistency-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-cross-surface-consistency\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: konsistensi format `PIN xxxx-xxxx` di DAFTAR PERCAKAPAN
      // (`/chat`) SETELAH scroll berulang (simulasi paginasi / infinite
      // scroll), pindah tab Aktif↔Arsip, dan `reload()`. Token PIN per
      // baris (`href`) wajib IDENTIK di seluruh fase; tidak ada baris
      // yang bocor nomor telp Indonesia mentah di judul, snippet, atau
      // aria-label.
      name: "chat-pin-mcm-list-pagination-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-list-pagination\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: konsistensi token `PIN xxxx-xxxx` di HEADER DM, BARIS HASIL
      // PENCARIAN, dan PANEL DETAIL saat pengguna memakai search/filter
      // di halaman daftar percakapan `/chat`. Token peer wajib identik
      // dari baseline daftar → hit pencarian → header DM → daftar
      // pasca-clear; tab Aktif↔Arsip serta panel "tidak ada hasil" tetap
      // bebas nomor telp Indonesia mentah.
      name: "chat-pin-mcm-list-search-filter-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-list-search-filter\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // E2E: konsistensi `PIN xxxx-xxxx` pada BARIS YANG BARU DIMOUNT
      // saat scroll di daftar `/chat` (virtualized list). Skenario
      // scroll cepat bolak-balik + polling `innerText` frekuensi
      // tinggi memastikan token PIN per `href` identik lintas
      // mount/unmount dan tidak pernah sesaat berupa nomor telp
      // Indonesia mentah.
      name: "chat-pin-mcm-virtualized-scroll-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-virtualized-scroll\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    // ── Lintas-browser paginasi/virtualisasi: skenario
    //   list-pagination & virtualized-scroll juga dijalankan di
    //   Firefox dan WebKit supaya konsistensi `PIN xxxx-xxxx` tidak
    //   bergantung pada engine Chromium. Perbedaan implementasi
    //   virtual scrolling (rAF timing, IntersectionObserver
    //   scheduling, normalisasi `innerText`) di ketiga engine tidak
    //   boleh memicu regresi token PIN atau kebocoran nomor telp.
    {
      name: "chat-pin-mcm-list-pagination-firefox-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-list-pagination\.spec\.ts/,
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
        trace: "on",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
      },
    },
    {
      name: "chat-pin-mcm-list-pagination-webkit-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-list-pagination\.spec\.ts/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
        trace: "on",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
      },
    },
    {
      name: "chat-pin-mcm-virtualized-scroll-firefox-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-virtualized-scroll\.spec\.ts/,
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
        trace: "on",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
      },
    },
    {
      name: "chat-pin-mcm-virtualized-scroll-webkit-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-virtualized-scroll\.spec\.ts/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
        trace: "on",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
      },
    },
    // ── Lintas-browser: gabungan search-filter + infinite scroll /
    //   load-more. PIN xxxx-xxxx tiap hit harus tetap identik saat
    //   halaman hasil bertambah, di Firefox maupun WebKit (bukan hanya
    //   Chromium) — perbedaan scheduling IntersectionObserver / rAF
    //   tidak boleh memicu regresi token PIN atau kebocoran nomor telp.
    {
      name: "chat-pin-mcm-search-scroll-pagination-firefox-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-search-scroll-pagination\.spec\.ts/,
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
        trace: "on",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
      },
    },
    {
      name: "chat-pin-mcm-search-scroll-pagination-webkit-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-search-scroll-pagination\.spec\.ts/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
        trace: "on",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
      },
    },
    // ── Alur "scroll list → buka detail baris yang baru dimount →
    //   history.back → scroll lagi": token PIN xxxx-xxxx pada header
    //   detail wajib identik dengan baris list, dan tetap identik
    //   setelah baris di-remount pasca navigasi kembali.
    {
      name: "chat-pin-mcm-scroll-detail-return-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-pin-mcm-scroll-detail-return\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    // ── Voice note pemutar: rekam → preview → kirim → tampil di
    //   transkrip virtualized. Static source guard selalu jalan; runtime
    //   memakai harness publik `/lovable/visual/voice-note-player`
    //   (no-auth, no-network) dengan sampel WAV in-memory.
    {
      name: "voice-note-player-e2e",
      testDir: "./tests/e2e",
      testMatch: /voice-note-player\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
      },
    },
    // Konsistensi label durasi setelah remount + scroll bolak-balik di
    // daftar virtualized-like. Harness sama, no-auth, no-network.
    {
      name: "voice-note-duration-remount-e2e",
      testDir: "./tests/e2e",
      testMatch: /voice-note-duration-remount\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
      },
    },
    // ── Dev-mode press-audit: verifikasi `console.warn` muncul dengan
    //   selector yang benar untuk komponen tanpa `data-no-press`.
    //   Butuh dev server (auditor hanya aktif di import.meta.env.DEV).
    {
      name: "press-audit-warnings-e2e",
      testDir: "./tests/e2e",
      testMatch: /press-audit-warnings\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    // ── Branding runtime: toggle Mode aplikasi ke "chat" harus
    //   mengganti title, theme-color, favicon, apple-touch-icon, dan
    //   target manifest tanpa reload.
    {
      name: "chat-mode-branding-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-mode-branding\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    // ── E2E migrator ekspor/impor `mcm.appearance-settings`: harness
    //   publik `/lovable/visual/appearance-import` memakai fungsi yang
    //   sama persis dengan `/pengaturan-tampilan`. Menguji v1, v2, versi
    //   lebih baru, `unknown_type`, dan payload rusak — kontrak backward
    //   compat impor untuk rilis berikutnya.
    //
    //   Portabilitas lokal: sandbox / mesin dev sering punya versi Chromium
    //   yang tidak cocok dengan versi bawaan `@playwright/test` (mis. hasil
    //   `bunx playwright install` gagal karena mirror diblokir, atau
    //   `PLAYWRIGHT_BROWSERS_PATH` menunjuk ke build lain). Supaya spec
    //   tetap bisa dijalankan tanpa reinstall, project ini menghormati:
    //     - `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (atau alias `CHROMIUM_PATH`)
    //       → path absolut ke binary Chromium/Chrome yang sudah ada di
    //       mesin. Dipakai sebagai `launchOptions.executablePath`.
    //     - `PLAYWRIGHT_CHANNEL` → nama channel (`chromium`, `chrome`,
    //       `msedge`) untuk memakai browser sistem via `channel`. Dipakai
    //       bila `executablePath` tidak diset.
    //   Kalau keduanya kosong, Playwright fallback ke Chromium bawaan seperti
    //   biasa (perilaku CI tidak berubah).
    {
      name: "appearance-import-migrator-e2e",
      testDir: "./tests/e2e",
      testMatch: /appearance-import-migrator\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL }
          : {}),
        launchOptions: {
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
          process.env.CHROMIUM_PATH
            ? {
                executablePath:
                  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
                  process.env.CHROMIUM_PATH,
              }
            : {}),
        },
      },
    },
    // ── PhotoEditor toolbar multi-viewport guard: memastikan semua
    //   tombol tool (Pilih..Lingkaran) + Batal/Simpan tetap terlihat
    //   dan aktionabel di viewport sempit termasuk 411×740 yang
    //   sempat memicu regresi "Lingkaran terpotong". Viewport per-test
    //   di-set lewat `test.use()` di spec — project ini hanya
    //   menghubungkan file spec ke runner.
    // ── Pratinjau WA rotasi portrait ↔ landscape: dialog harus tetap
    //   utuh di viewport, tanpa overflow horizontal, footer/tombol
    //   selalu actionable. Viewport di-set per-test di dalam spec.
    {
      name: "wa-preview-orientation-e2e",
      testDir: "./tests/e2e",
      testMatch: /wa-preview-orientation\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
      },
    },
    // ── Focus trap dialog pratinjau saat konten dimuat bertahap (state
    //   loading retry foto): fokus tidak boleh lolos ke <body>/latar, dan
    //   harus pulih ke tombol pemicu setelah dialog ditutup.
    {
      name: "wa-preview-focus-loading-e2e",
      testDir: "./tests/e2e",
      testMatch: /wa-preview-focus-loading\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
      },
    },
    // ── Dialog `ui/dialog` di WebView Android: layout viewport lebih
    //   tinggi daripada area terlihat (toolbar/keyboard). Kartu tidak
    //   boleh melorot ke bawah layar atau terpotong.
    {
      name: "dialog-webview-viewport-e2e",
      testDir: "./tests/e2e",
      testMatch: /dialog-webview-viewport\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 360, height: 800 },
      },
    },
    {
      name: "photo-editor-toolbar-viewports-e2e",
      testDir: "./tests/e2e",
      testMatch: /photo-editor-toolbar-viewports\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
      },
    },
    // ── PhotoEditor keyboard + orientation safe-area guard: memastikan
    //   root editor ter-offset lewat `bottom: kbInset` saat visualViewport
    //   shrink (keyboard) dan kembali ke 0 saat tertutup. Juga menguji
    //   rotasi portrait ↔ landscape.
    {
      name: "photo-editor-keyboard-safe-area-e2e",
      testDir: "./tests/e2e",
      testMatch: /photo-editor-keyboard-safe-area\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 740 },
      },
    },
    {
      // Skenario : Queue produk pada composer chat saat jaringan drop
      //            di tengah pengiriman. Semua item WAJIB tetap di
      //            composer dgn status "failed" + localStorage v2 utuh,
      //            dan setelah reconnect + retry, queue kosong & key
      //            localStorage dihapus.
      // Harness  : /lovable/visual/chat-queue-network-drop (no-auth).
      // Tujuan   : Regresi guard untuk hardening 12 Jul 2026 — sebelum
      //            fix, kegagalan tengah-loop bisa menghilangkan chip
      //            dari composer. Non-tautologi: harness mengimpor
      //            `PENDING_PRODUCTS_VERSION` dari modul yang sama dgn
      //            route produksi (`@/lib/chat-queue-schema`).
      name: "chat-queue-network-drop-e2e",
      testDir: "./tests/e2e",
      testMatch: /chat-queue-network-drop\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 893 },
      },
    },
    {
      // Skenario : Operasi kategori (tambah / rename case-insensitive /
      //            hapus / reorder) di Beranda tetap konsisten dengan
      //            Gudang. Butuh sesi login (storageState) — auto-skip
      //            saat storageState kosong. Viewport 411×915 (device
      //            Ace).
      // Harness  : / (Beranda) + /gudang, tabel warehouse_categories +
      //            warehouse_items. Data seed & cleanup via SERVICE_ROLE.
      name: "warehouse-categories-consistency-e2e",
      testDir: "./tests/e2e",
      testMatch: /warehouse-categories-consistency\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 915 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // Skenario : Angka hutang/piutang satu kontak ("Dompeng") tampil
      //            identik di layar — chip daftar chat, chip header
      //            percakapan, dan kartu Hutang & Piutang. Harness
      //            publik selalu jalan; bagian halaman asli (/chat +
      //            /hutang-piutang) auto-skip tanpa sesi login.
      // Harness  : /lovable/visual/debt-ssot-consistency (no-auth).
      name: "debt-ssot-dompeng-consistency-e2e",
      testDir: "./tests/e2e",
      testMatch: /debt-ssot-dompeng-consistency\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 411, height: 915 },
        storageState: "tests/visual/.auth/user.json",
      },
    },
    {
      // Skenario : Chip hutang/piutang tetap rapi (tidak tumpah keluar
      //            border, tinggi seragam, nominal terpotong selalu
      //            punya keterangan penuh) di lebar 320–1280px.
      // Harness  : /lovable/visual/debt-ssot-consistency (no-auth) —
      //            viewport diatur per-test, jadi tanpa device preset.
      name: "debt-chip-responsive-e2e",
      testDir: "./tests/e2e",
      testMatch: /debt-chip-responsive\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      // Skenario : Penutupan BERANTAI layer portal bertumpuk (dialog →
      //            popover → select) saat isi kedua layer lazy-load lalu
      //            re-render. Fokus harus pulih ke pemicu tiap layer
      //            sesuai urutan penutupan, tidak pernah ke <body>.
      // Harness  : /lovable/visual/focus-portal-stack (no-auth) yang
      //            memakai hook produksi `usePortalFocusStack`.
      name: "focus-portal-stack-e2e",
      testDir: "./tests/e2e",
      testMatch: /focus-portal-stack\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
    {
      // Skenario : Simulasi notch/status bar (inset --app-safe-*) pada
      //            ukuran HP 320–411 px dan tablet 768/1024 px. Setiap
      //            elemen daun yang terlihat harus berada di dalam kotak
      //            aman viewport. Viewport diatur per-test.
      name: "safe-area-notch-e2e",
      testDir: "./tests/e2e",
      testMatch: /safe-area-notch\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL }
          : {}),
        launchOptions: {
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
          process.env.CHROMIUM_PATH
            ? {
                executablePath:
                  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
                  process.env.CHROMIUM_PATH,
              }
            : {}),
        },
      },
    },
    {
      // Jarak aman FAB & action bar terhadap gesture bar / home indicator.
      // Spec mengatur viewport & orientasi sendiri (320–1024, portrait +
      // landscape), jadi di sini cukup basis Chromium bertouch.
      name: "fab-clearance-e2e",
      testDir: "./tests/e2e",
      testMatch: /fab-action-bar-clearance\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: false,
        hasTouch: true,
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL }
          : {}),
        launchOptions: {
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
          process.env.CHROMIUM_PATH
            ? {
                executablePath:
                  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
                  process.env.CHROMIUM_PATH,
              }
            : {}),
        },
      },
    },
    {
      // Split-screen (tinggi sangat pendek) & jendela browser kecil,
      // termasuk simulasi keyboard terbuka. Viewport diatur per-test.
      name: "split-screen-clearance-e2e",
      testDir: "./tests/e2e",
      testMatch: /split-screen-clearance\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 412, height: 360 },
        isMobile: false,
        hasTouch: true,
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL }
          : {}),
        launchOptions: {
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
          process.env.CHROMIUM_PATH
            ? {
                executablePath:
                  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
                  process.env.CHROMIUM_PATH,
              }
            : {}),
        },
      },
    },
  ],
});