// README scenario: README.md#apk-scenario-mount-quiescent
import { test, expect } from "@playwright/test";
import { installApkStub } from "./_apk-availability-stub";

/**
 * E2E: contoh referensi hasil menyalin `_helpers/apk-spec.template.ts`
 * menjadi spec asli. Skenarionya sederhana namun invarian yang dijaga
 * penting untuk regresi:
 *
 *   > Setelah mount di `/lovable/visual/apk-availability-shortcuts`
 *   > dengan kedua varian merespons kosong, TIDAK boleh ada request
 *   > `getApkVariantDetail` tambahan (tidak ada polling background,
 *   > tidak ada refetch-on-focus, tidak ada interval query).
 *
 * Menggunakan pola yang sama dengan template:
 *   - `installApkStub` + `primeInitial` + `assertPrimed` sebelum goto.
 *   - `waitForServed` untuk sinkronisasi mount, bukan `waitForTimeout`.
 *   - `assertQuiescent` per varian (window + stableTicks) → menangkap
 *     polling & refetch on-focus.
 *   - `terminalGuard` sebagai leak-guard akhir (kedua varian).
 */

const URL = "/lovable/visual/apk-availability-shortcuts";

test.describe("APK mount · quiescent guard (contoh dari template)", () => {
  test("mount dengan rilis kosong: tidak ada request tambahan setelah fetch awal", async ({
    page,
  }) => {
    // (1) Setup stub — WAJIB sebelum goto.
    const stub = await installApkStub(page);
    stub.primeInitial(); // kedua varian kosong (state "Belum tersedia")
    stub.assertPrimed();

    await page.goto(URL);

    // Sinkron deterministik: tunggu event served fetch awal SEBELUM
    // mengukur label. Tanpa ini, assertion bisa firing sebelum React
    // sempat render.
    await stub.waitForServed("chat", 1);
    await stub.waitForServed("storage", 1);

    // (2) State awal — label idle terlihat di kedua varian.
    const chatDl = page.getByTestId("apk-shortcut-download-chat");
    const storageDl = page.getByTestId("apk-shortcut-download-storage");
    await expect(chatDl.getByText("Belum tersedia")).toBeVisible();
    await expect(storageDl.getByText("Belum tersedia")).toBeVisible();

    // Snapshot request count SEBELUM quiescent guard — konfirmasi bahwa
    // fetch awal sudah 1x per varian, tidak lebih.
    expect(stub.requestedCount("chat")).toBe(1);
    expect(stub.requestedCount("storage")).toBe(1);

    // (3) Post-mount quiescent guard — pola dari template.
    //
    // `assertQuiescent` menggabungkan dua fase deterministik:
    //   - Fase window: 1000ms bounded upper-bound, event-based —
    //     kalau ada request tambahan masuk, gagal cepat.
    //   - Fase stableTicks: 5 event-loop ticks (setTimeout 0 +
    //     microtask flush) untuk menangkap task tertunda yang
    //     baru firing setelah window lewat.
    await stub.assertQuiescent("chat", { windowMs: 1000, stableTicks: 5 });
    await stub.assertQuiescent("storage", { windowMs: 1000, stableTicks: 5 });

    // (4) Terminal leak-guard — pola dari template.
    // `terminalGuard` = alias untuk `assertNoAdditionalRequests` tanpa
    // action, dengan `windowMs = APK_STUB_TERMINAL_WINDOW_MS` default.
    // Cek kedua varian sekaligus (variant tidak di-set → chat + storage).
    await stub.terminalGuard();

    // (5) Snapshot akhir untuk transparansi log CI — counter tetap
    // 1 per varian membuktikan zero-leak sepanjang test.
    expect(stub.requestedCount("chat")).toBe(1);
    expect(stub.servedCount("chat")).toBe(1);
    expect(stub.requestedCount("storage")).toBe(1);
    expect(stub.servedCount("storage")).toBe(1);
    expect(stub.pending().waiters).toBe(0);
  });
});