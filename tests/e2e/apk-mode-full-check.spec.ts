/**
 * Spec E2E APK — flow "apk-mode-full-check".
 *
 * Dibuat dari `tests/e2e/_helpers/apk-spec.template.ts` via
 * `scripts/scaffold-apk-e2e-spec.mjs` (--mode full).
 * Pola guard (`trackedClick`,
 * `trackedAction`, `assertQuiescent`, `terminalGuard`) sudah
 * terpasang — LENGKAPI, JANGAN HAPUS.
 * Mode: FULL guards — memasang `installServerFnPassthroughGuard`
 * di setup dan menutup dengan `stub.terminalGuard()` + passthrough
 * assertion. Gunakan untuk flow yang menyentuh server function di luar
 * `getApkVariantDetail` (copy chat link, export, dll).
 *
 * Detail pola & anti-pattern:
 * `tests/e2e/_helpers/README.md`.
 */


import { test, expect } from "@playwright/test";
import { installApkStub, makeRelease } from "./_apk-availability-stub";
import { installServerFnPassthroughGuard } from "./_helpers/serverfn-passthrough-guard";

// Ganti URL sesuai harness yang diuji (contoh: shortcut / halaman admin).
const URL = "/lovable/visual/apk-availability-shortcuts";

test.describe("APK apk-mode-full-check — deterministic guard", () => {
  test("<skenario yang diuji>", async ({ page }) => {
    // ────────────────────────────────────────────────────────────
    // (1) SETUP STUB — WAJIB SEBELUM page.goto
    // ────────────────────────────────────────────────────────────
    const stub = await installApkStub(page);
    // Mode FULL: pantau SEMUA server function (bukan hanya
    // getApkVariantDetail). Wajib bila flow menyentuh copy/export/link.
    const passthrough = await installServerFnPassthroughGuard(page);

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

    // Mode FULL: verifikasi tidak ada server-fn asing (selain APK) yang
    // firing setelah semua aksi selesai. windowMs default 750ms.
    await passthrough.assertNoAdditionalRequests({ windowMs: 750 });
    await passthrough.dispose();

    // ────────────────────────────────────────────────────────────
    // (7) SNAPSHOT AKHIR — transparansi log CI (opsional)
    // ────────────────────────────────────────────────────────────
    expect(stub.pending().waiters).toBe(0);
  });
});