import { test, expect } from "@playwright/test";
import { installApkStub, makeRelease } from "./_apk-availability-stub";

/**
 * E2E: alur pengecekan ulang ketersediaan APK pada tiga tombol pintas
 * di /lovable/visual/apk-availability-shortcuts:
 *
 *   1. Kondisi awal: server function `getApkVariantDetail` mengembalikan
 *      rilis kosong → tombol tampil idle "Belum tersedia" dengan ikon
 *      refresh terlihat, tanpa toast merah.
 *   2. Setelah rilis muncul di sisi server (respons berikutnya di-enqueue
 *      via `installApkStub` — deterministik, TANPA flag yang di-flip di
 *      tengah test), mengetuk ikon refresh memicu refetch dan tombol
 *      otomatis berganti ke state aktif dengan label unduhan/salin.
 */

const URL = "/lovable/visual/apk-availability-shortcuts";

test.describe("APK availability · refresh flow", () => {
  test("belum tersedia → tap refresh → aktif", async ({ page }) => {
    // Deterministik: respons TIDAK bergantung urutan wall-clock antara
    // "flip flag" dan handler membaca flag. Test meng-enqueue respons
    // per-varian secara eksplisit; handler menunggu antrian sebelum
    // menjawab, sehingga test lebih stabil di CI yang lambat.
    const stub = await installApkStub(page);

    // Fetch awal (mount): kedua varian kembalikan rilis kosong.
    // `primeInitial()` + `assertPrimed()` menegaskan setup halaman
    // SUDAH lengkap sebelum navigasi — kalau lupa, test gagal cepat
    // (bukan hang menunggu waiter yang tidak pernah di-enqueue).
    stub.primeInitial();
    stub.assertPrimed();
    await page.goto(URL);

    // Sinkronisasi deterministik: tunggu event served untuk kedua
    // fetch awal (chat + storage) sebelum mengukur state idle.
    await stub.waitForServed("chat", 1);
    await stub.waitForServed("storage", 1);

    // Wrapper testid untuk membatasi query per tombol (aria-label bisa
    // mirip antar varian, mis. tombol refresh Storage vs Chat).
    const chatDl = page.getByTestId("apk-shortcut-download-chat");
    const storageDl = page.getByTestId("apk-shortcut-download-storage");
    const copyChat = page.getByTestId("apk-shortcut-copy-chat-links");

    // === State awal: "Belum tersedia" untuk ketiganya ===
    await expect(chatDl.getByText("Belum tersedia")).toBeVisible();
    await expect(storageDl.getByText("Belum tersedia")).toBeVisible();
    await expect(copyChat.getByText("Belum tersedia")).toBeVisible();

    // Tidak ada toast error/banner merah di atas (sonner: role=status).
    // Semua toaster tidak menampilkan pesan gagal.
    await expect(page.getByText(/Gagal/i)).toHaveCount(0);

    // Ikon refresh terlihat di ketiga tombol saat kondisi tidak tersedia.
    const chatRefresh = chatDl.getByRole("button", {
      name: /Cek ulang ketersediaan APK MCM Chat/i,
    });
    const storageRefresh = storageDl.getByRole("button", {
      name: /Cek ulang ketersediaan APK MCM Storage/i,
    });
    const copyRefresh = copyChat.getByRole("button", {
      name: /Cek ulang ketersediaan APK MCM Chat/i,
    });
    await expect(chatRefresh).toBeVisible();
    await expect(storageRefresh).toBeVisible();
    await expect(copyRefresh).toBeVisible();

    // === Enqueue respons "tersedia" untuk tiap refetch yang akan
    // dipicu oleh tap tombol refresh. Karena handler menunggu antrian,
    // tidak ada race: request akan mendapat payload yang benar apa pun
    // urutan penjadwalan Chromium.
    stub.enqueue("chat", [makeRelease("chat")]);
    stub.enqueue("storage", [makeRelease("storage")]);
    stub.enqueue("chat", [makeRelease("chat")]);

    await chatRefresh.click();
    await storageRefresh.click();
    await copyRefresh.click();

    // Tunggu event served untuk ketiga refetch (chat×2 karena copyChat
    // & main chat berbagi query key → mungkin dedupe jadi 1; storage×1).
    // Cukup pastikan servedCount naik: chat >= 2, storage >= 2.
    await stub.waitForServed("storage", 2);
    await stub.waitForServed("chat", 2);

    // Tombol otomatis aktif — label ganti ke aksi utama, ikon refresh hilang.
    // Assert label PERSIS per varian (exact match) supaya salah label / label
    // tertukar (mis. tombol Chat menampilkan "Storage") langsung gagal.
    await expect(
      chatDl.getByText("Unduh APK Chat", { exact: true }),
    ).toBeVisible();
    await expect(
      storageDl.getByText("Unduh APK Storage", { exact: true }),
    ).toBeVisible();
    await expect(
      copyChat.getByText("Salin link APK Chat", { exact: true }),
    ).toBeVisible();

    // Cross-variant guard: label varian lain tidak boleh muncul di dalam
    // wrapper varian yang salah.
    await expect(chatDl.getByText(/Storage/i)).toHaveCount(0);
    await expect(storageDl.getByText(/Chat/i)).toHaveCount(0);
    await expect(
      copyChat.getByText("Unduh APK Chat", { exact: true }),
    ).toHaveCount(0);
    await expect(
      copyChat.getByText("Unduh APK Storage", { exact: true }),
    ).toHaveCount(0);

    // State idle "Belum tersedia" sudah tidak ada di ketiganya.
    await expect(chatDl.getByText("Belum tersedia")).toHaveCount(0);
    await expect(storageDl.getByText("Belum tersedia")).toHaveCount(0);
    await expect(copyChat.getByText("Belum tersedia")).toHaveCount(0);

    await expect(
      chatDl.getByRole("button", {
        name: /Cek ulang ketersediaan APK MCM Chat/i,
      }),
    ).toHaveCount(0);
    await expect(
      storageDl.getByRole("button", {
        name: /Cek ulang ketersediaan APK MCM Storage/i,
      }),
    ).toHaveCount(0);
    await expect(
      copyChat.getByRole("button", {
        name: /Cek ulang ketersediaan APK MCM Chat/i,
      }),
    ).toHaveCount(0);
  });
});