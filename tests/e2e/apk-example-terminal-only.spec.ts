// README scenario: README.md#apk-scenario-example-terminal-only
/**
 * Spec E2E APK — CONTOH PEMBANDING: HANYA `terminalGuard`, tanpa
 * `installServerFnPassthroughGuard`.
 *
 * Referensi bandingan:
 *   - `tests/e2e/_helpers/apk-spec.template.ts` → menjelaskan kedua
 *     opsi (terminalGuard vs passthrough) sebagai "flow D" untuk
 *     copy/export chat link.
 *   - `tests/e2e/apk-mount-quiescent.spec.ts` → pola mount-only
 *     (tanpa aksi refetch), juga terminalGuard-only.
 *   - Spec INI → pola mount + refetch (trackedClick), tetap
 *     terminalGuard-only.
 *
 * Kapan pola ini cukup (TIDAK perlu passthrough guard):
 *   1. Flow hanya menyentuh `getApkVariantDetail` — tidak ada aksi
 *      copy/export chat link atau server function lain.
 *   2. Semua aksi refetch sudah di-wrap `trackedClick`/`trackedAction`
 *      (guard per-aksi memantau `getApkVariantDetail`).
 *   3. `terminalGuard()` di akhir cukup untuk membuktikan tidak ada
 *      polling / refetch-on-focus tertinggal untuk KEDUA varian.
 *
 * Kapan harus upgrade ke `installServerFnPassthroughGuard`:
 *   - Spec juga memicu server function di luar APK (copy chat link,
 *     export, dsb.). Passthrough guard memantau SEMUA server fn,
 *     bukan cuma `getApkVariantDetail`.
 *   - Pasang passthrough di setup, TETAP tutup dengan `terminalGuard()`.
 */


import { test, expect } from "@playwright/test";
import { installApkStub, makeRelease } from "./_apk-availability-stub";

const URL = "/lovable/visual/apk-availability-shortcuts";

test.describe("APK example · terminalGuard-only (tanpa passthrough)", () => {
  test("mount + refetch chat: terminalGuard cukup untuk buktikan zero-leak", async ({
    page,
  }) => {
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
      name: /Cek ulang ketersediaan APK Ace Chat/i,
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