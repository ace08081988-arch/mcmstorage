/**
 * TEMPLATE — kerangka spec E2E untuk flow APK (varian `chat` / `storage`)
 * yang MEMICU `getApkVariantDetail`. File ini SENGAJA tidak diakhiri
 * `.spec.ts` — Playwright config memakai `testMatch` per-spec, jadi
 * template tidak akan pernah dijalankan.
 *
 * Cara copy-rename:
 *   1. Copy file ini ke `tests/e2e/<nama-flow>.spec.ts`.
 *   2. Ganti `APK <flow-name>` di `test.describe(...)` dengan nama flow.
 *   3. Ganti `URL` dengan harness/route yang benar-benar diuji.
 *   4. Sesuaikan `primeInitial()` / `enqueue()` / `trackedClick(...)`
 *      dengan aksi flow yang sedang diuji.
 *   5. Tambahkan project baru di `playwright.config.ts` dengan
 *      `testMatch: /<nama-flow>\.spec\.ts/`.
 *   6. Atau gunakan generator: `node scripts/scaffold-apk-e2e-spec.mjs --name <nama-flow>`.
 *
 * Parameter stub yang diperlukan (jangan dihapus):
 *   - `installApkStub(page)` → wajib panggil pertama kali sebelum `page.goto()`.
 *   - `stub.primeInitial()` + `stub.assertPrimed()` → wajib sebelum `page.goto()`.
 *   - `stub.waitForServed(variant, count)` → sinkronisasi deterministik setelah mount.
 *   - `stub.trackedClick(...)` / `stub.trackedAction(...)` → wajib untuk setiap aksi
 *     yang memicu refetch; `expected` sekaligus jadi regression check.
 *   - `stub.assertQuiescent(variant, { windowMs, stableTicks })` → cek handler benar-benar
 *     idle setelah state aktif tercapai.
 *   - `stub.terminalGuard()` → wajib di akhir spec untuk menangkap leak jangka panjang.
 *
 * terminalGuard vs installServerFnPassthroughGuard:
 *   - Gunakan `stub.terminalGuard()` di AKHIR spec APK saja. Ini hanya memantau
 *     `getApkVariantDetail` (chat/storage) dan memastikan tidak ada request
 *     refetch/polling tambahan setelah semua aksi user selesai.
 *   - Gunakan `installServerFnPassthroughGuard(page, { whitelist: [...] })` untuk flow
 *     yang melibatkan copy/export chat links (misal `chat-pin-mcm-copy-export`).
 *     Guard itu memantau SEMUA server function (bukan cuma APK) dan akan
 *     menangkap kebocoran request copy/export yang tidak diharapkan.
 *   - Keduanya bisa dipakai bersama di flow APK + copy/export: pasang passthrough
 *     guard di setup, lalu tutup spec dengan `stub.terminalGuard()`.
 *
 * Checklist anti-pattern — jangan lakukan di spec APK:
 *
 *   ❌ Jangan memanggil `assertNoAdditionalRequests` secara manual dengan
 *     `windowMs` literal. Pakai `stub.trackedClick(...)` / `stub.trackedAction(...)`
 *     supaya threshold & log error konsisten.
 *
 *   ❌ Jangan menulis `page.waitForTimeout(...)` atau `expect.poll(...)` sebagai
 *     sinkronisasi alur. Semua tunggu harus event-based (`waitForServed`,
 *     `waitForHold`, `waitForIdle`).
 *
 *   ❌ Jangan lupa `stub.assertPrimed()` sebelum `page.goto()`. Tanpa ini,
 *     waiter mount bisa tergantung tanpa respons, dan test akan hang.
 *
 *   ❌ Jangan lupa `stub.waitForServed(variant, count)` sebelum mengukur UI.
 *     Assertion UI awal harus menunggu React render state yang sudah
 *     deterministik.
 *
 *   ❌ Jangan melewatkan `expected` di `trackedClick` untuk aksi refetch.
 *     `expected` bukan cuma whitelist, tapi juga regression check: kalau
 *     tap tiba-tiba tidak memicu refetch, test harus gagal.
 *
 *   ❌ Jangan memanggil `assertQuiescent` sebelum `waitForIdle` / state aktif
 *     tercapai. Quiescent guard hanya berarti setelah handler tidak lagi
 *     menangani request aktif.
 *
 *   ❌ Jangan membiarkan spec berakhir tanpa `stub.terminalGuard()` — kecuali
 *     spec memang bukan flow APK (bukan `getApkVariantDetail`).
 *
 *   ❌ Jangan mengganti `waitForServed` / `waitForIdle` dengan `terminalGuard`.
 *     `terminalGuard` hanya membuktikan *absence* leak di akhir, bukan
 *     menunggu request selesai di-fulfill.
 *
 *   ❌ Jangan menambahkan `assertQuiescent` di setiap aksi kecil. Gunakan
 *     `trackedClick` per-aksi, dan `assertQuiescent` hanya sekali setelah
 *     state aktif tercapai.
 *
 * Prinsip yang WAJIB dipertahankan:
 *
 *   - **Deterministik**: tidak boleh ada `page.waitForTimeout` atau
 *     `expect.poll` sebagai sinkronisasi alur. Semua tunggu-menunggu
 *     berbasis event stub (`waitForServed`, `waitForHold`, `waitForIdle`).
 *
 *   - **Guard per-aksi**: setiap klik yang MEMICU refetch dibungkus
 *     `stub.trackedClick(...)` atau `stub.trackedAction(...)`. Jangan
 *     panggil `assertNoAdditionalRequests` manual dengan `windowMs`
 *     literal — helper otomatis pakai `APK_STUB_PER_ACTION_WINDOW_MS`.
 *
 *   - **Quiescent guard**: setelah state aktif tercapai (label akhir
 *     terlihat, tombol tidak lagi busy), verifikasi handler benar-benar
 *     idle via `stub.assertQuiescent(variant, { windowMs, stableTicks })`.
 *
 *   - **Terminal guard**: SEBELUM test selesai, panggil
 *     `stub.terminalGuard()` — memastikan kedua varian bebas leak
 *     dengan `APK_STUB_TERMINAL_WINDOW_MS` default.
 *
 *   - **primeInitial + assertPrimed**: WAJIB sebelum `page.goto(URL)`.
 *     Tanpa itu handler akan menahan waiter fetch awal selamanya.
 *
 * Referensi lengkap pola & anti-pattern: `tests/e2e/_helpers/README.md`.
 */

import { test, expect } from "@playwright/test";
import { installApkStub, makeRelease } from "../_apk-availability-stub";

// Ganti URL sesuai harness yang diuji (contoh: shortcut / halaman admin).
const URL = "/lovable/visual/apk-availability-shortcuts";

test.describe("APK <flow-name> — deterministic guard", () => {
  test("<skenario yang diuji>", async ({ page }) => {
    // ────────────────────────────────────────────────────────────
    // (1) SETUP STUB — WAJIB SEBELUM page.goto
    // ────────────────────────────────────────────────────────────
    const stub = await installApkStub(page);

    // Enqueue respons untuk fetch AWAL kedua varian (mount).
    // Default `primeInitial()` = kedua varian kosong (state "Belum
    // tersedia"). Kalau butuh state awal berbeda, isi releases:
    //   stub.primeInitial([makeRelease("chat")], []);
    stub.primeInitial();
    stub.assertPrimed();

    await page.goto(URL);

    // Sinkron deterministik: tunggu event served untuk fetch AWAL
    // kedua varian SEBELUM mengukur label idle. Tanpa ini, assertion
    // UI bisa firing sebelum React sempat render state kosong.
    await stub.waitForServed("chat", 1);
    await stub.waitForServed("storage", 1);

    // ────────────────────────────────────────────────────────────
    // (2) STATE AWAL — assertion UI idle
    // ────────────────────────────────────────────────────────────
    const chatDl = page.getByTestId("apk-shortcut-download-chat");
    const storageDl = page.getByTestId("apk-shortcut-download-storage");

    await expect(chatDl.getByText("Belum tersedia")).toBeVisible();
    await expect(storageDl.getByText("Belum tersedia")).toBeVisible();

    // ────────────────────────────────────────────────────────────
    // (3) AKSI USER — WAJIB DIBUNGKUS GUARD PER-AKSI
    // ────────────────────────────────────────────────────────────
    const chatRefresh = chatDl.getByRole("button", {
      name: /Cek ulang ketersediaan APK MCM Chat/i,
    });

    // Enqueue respons refetch SEBELUM klik supaya handler dijamin
    // punya payload begitu request tiba (deterministik).
    stub.enqueue("chat", [makeRelease("chat")]);

    // `trackedClick` = klik + `assertNoAdditionalRequests` per-aksi
    // dengan `APK_STUB_PER_ACTION_WINDOW_MS` default. `expected`
    // bertindak ganda: (a) whitelist kuantitatif, (b) regression check
    // — kalau tap tidak lagi memicu refetch, test gagal cepat.
    await stub.trackedClick(chatRefresh, { expected: { chat: 1 } });

    // Pola "hold → release" (opsional) — hanya kalau perlu observasi
    // state busy/"Memeriksa…":
    //
    //   await stub.trackedClick(chatRefresh, { variant: "storage" });
    //   await stub.waitForHold("chat");           // request tergantung
    //   await expect(chatDl.getByText("Memeriksa…")).toBeVisible();
    //   stub.enqueue("chat", [makeRelease("chat")]); // release waiter
    //   await stub.waitForServed("chat", 2);

    // Tunggu handler benar-benar idle setelah aksi terakhir sebelum
    // assertion label baru.
    await stub.waitForIdle();

    // ────────────────────────────────────────────────────────────
    // (4) STATE AKTIF — assertion UI + cross-variant guard
    // ────────────────────────────────────────────────────────────
    await expect(
      chatDl.getByText("Unduh APK Chat", { exact: true }),
    ).toBeVisible();
    // Cross-variant guard: label varian lain tidak boleh muncul.
    await expect(chatDl.getByText(/Storage/i)).toHaveCount(0);

    // ────────────────────────────────────────────────────────────
    // (5) POST-ACTIVE QUIESCENT GUARD — event-based
    // ────────────────────────────────────────────────────────────
    // Cek: setelah state aktif tercapai, TIDAK boleh ada request
    // tambahan (polling background / refetch-on-focus / interval
    // query). `stableTicks` = pengaman ekstra untuk task tertunda.
    await stub.assertQuiescent("chat", { windowMs: 1000, stableTicks: 5 });
    await stub.assertQuiescent("storage", { windowMs: 500, stableTicks: 5 });

    // ────────────────────────────────────────────────────────────
    // (6) TERMINAL GUARD — WAJIB terakhir
    // ────────────────────────────────────────────────────────────
    // Cek kedua varian sekaligus. `windowMs` default =
    // APK_STUB_TERMINAL_WINDOW_MS (lebih longgar dari per-aksi
    // karena harus menangkap timer/refetch yang tertunda beberapa
    // ratus ms setelah aksi terakhir).
    await stub.terminalGuard();

    // ────────────────────────────────────────────────────────────
    // (7) SNAPSHOT AKHIR — transparansi log CI (opsional)
    // ────────────────────────────────────────────────────────────
    expect(stub.pending().waiters).toBe(0);
  });
});