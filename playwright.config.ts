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
      // dialog "Chat baru" tetap memakai placeholder PIN MCM.
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
      // E2E: fuzz PIN MCM lintas hingga 5 DM acak — header + transkrip
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
  ],
});