import { test, expect } from "@playwright/test";
import { installApkStub, makeRelease } from "./_apk-availability-stub";

/**
 * E2E: tombol refresh pada <DownloadStorageApkShortcut> hanya
 * memicu SATU refetch per tap dan TIDAK mengirim request tambahan
 * setelah state berubah menjadi aktif ("Unduh APK Storage").
 *
 * Mekanisme:
 *   - `installApkStub` menghitung `servedCount` per varian untuk
 *     setiap request `_serverFn` yang di-fulfill (deterministik,
 *     bukan spy pada `page.request`).
 *   - Baseline: 1 request chat + 1 request storage untuk fetch awal.
 *   - Tiap tap refresh: +1 storage (chat tidak bertambah).
 *   - Setelah aktif, tunggu network idle + jeda tambahan → servedCount
 *     storage TETAP sama (tidak ada polling / refetch background).
 */

const URL = "/lovable/visual/apk-availability-shortcuts";

test.describe("APK refresh · single refetch per tap", () => {
  test("storage: satu tap = satu refetch, tidak ada request tambahan setelah aktif", async ({
    page,
  }) => {
    const stub = await installApkStub(page);
    // Penegasan setup halaman sebelum navigasi: kedua fetch awal
    // wajib punya respons ter-enqueue. assertPrimed() gagal cepat
    // kalau lupa, mencegah handler menggantung waiter tak berujung.
    stub.primeInitial();
    stub.assertPrimed();
    await page.goto(URL);

    const storageDl = page.getByTestId("apk-shortcut-download-storage");
    // Baseline deterministik: tunggu event served (bukan polling
    // wall-clock / assumption bahwa "Belum tersedia" visible = fetch
    // sudah selesai). Setelah dua event served masuk, counter fetch
    // awal pasti 1 per varian.
    await stub.waitForServed("chat", 1);
    await stub.waitForServed("storage", 1);
    expect(stub.servedCount("storage")).toBe(1);
    expect(stub.servedCount("chat")).toBe(1);
    await expect(storageDl.getByText("Belum tersedia")).toBeVisible();

    const storageRefresh = storageDl.getByRole("button", {
      name: /Cek ulang ketersediaan APK MCM Storage/i,
    });

    // === Tap #1: harus memicu tepat SATU refetch storage ===
    stub.enqueue("storage", []);
    await storageRefresh.click();

    // Tunggu event served ke-2 untuk storage (deterministik, bukan
    // expect.poll dengan interval wall-clock).
    await stub.waitForServed("storage", 2);
    // Chat TIDAK ikut refetch — query independen per-varian.
    expect(stub.servedCount("chat")).toBe(1);

    // Tombol masih idle karena rilis kosong (label refresh tetap ada).
    await expect(storageDl.getByText("Belum tersedia")).toBeVisible();

    // === Tap #2: aktifkan dengan rilis tersedia — tetap 1 refetch ===
    stub.enqueue("storage", [makeRelease("storage")]);
    await storageRefresh.click();

    await stub.waitForServed("storage", 3);
    await expect(
      storageDl.getByText("Unduh APK Storage", { exact: true }),
    ).toBeVisible();
    expect(stub.servedCount("storage")).toBe(3);
    expect(stub.servedCount("chat")).toBe(1);

    // === Post-active guard: tidak ada request tambahan ===
    // Setelah state aktif, tombol refresh tidak lagi dirender.
    await expect(
      storageDl.getByRole("button", {
        name: /Cek ulang ketersediaan APK MCM Storage/i,
      }),
    ).toHaveCount(0);

    // Assert quiescent: helper memastikan antrian handler kosong,
    // snapshot counter, lalu memverifikasi TIDAK ada request tambahan
    // dalam jendela bounded. Kalau ada polling background / refetch
    // on-focus / interval query, helper akan gagal karena counter
    // bergerak.
    await stub.assertQuiescent("storage", { windowMs: 1500 });
    await stub.assertQuiescent("chat", { windowMs: 500 });

    // Snapshot akhir untuk transparansi log CI.
    expect(stub.servedCount("storage")).toBe(3);
    expect(stub.requestedCount("storage")).toBe(3);
    expect(stub.servedCount("chat")).toBe(1);
    expect(stub.requestedCount("chat")).toBe(1);
    expect(stub.pending().waiters).toBe(0);
  });
});
