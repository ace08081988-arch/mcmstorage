import { test, expect } from "@playwright/test";
import { installApkStub, makeRelease } from "./_apk-availability-stub";
import {
  APK_STUB_PER_ACTION_WINDOW_MS,
  APK_STUB_TERMINAL_WINDOW_MS,
} from "./_helpers/apk-stub-timing";

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

    // Sinkronisasi deterministik: tunggu handler idle (semua request
    // in-flight sudah di-fulfill, tidak ada waiter tertahan) — ini
    // cukup untuk menjamin kedua fetch awal selesai TANPA hardcode
    // jumlah served yang bisa berubah kalau harness diperluas.
    await stub.waitForIdle();

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

    // Wrap tiap tap refresh dengan assertNoAdditionalRequests supaya
    // kebocoran per-aksi tertangkap konsisten (bukan hanya via terminal
    // guard di akhir). `expected` juga bertindak sebagai regression
    // check: kalau tap ini tidak lagi memicu refetch, test gagal cepat.
    await stub.assertNoAdditionalRequests(
      async () => {
        await chatRefresh.click();
      },
      { expected: { chat: 1 }, windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
    );
    await stub.assertNoAdditionalRequests(
      async () => {
        await storageRefresh.click();
      },
      { expected: { storage: 1 }, windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
    );
    await stub.assertNoAdditionalRequests(
      async () => {
        await copyRefresh.click();
      },
      { expected: { chat: 1 }, windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
    );

    // Tunggu handler idle lagi setelah ketiga tap refresh — semua
    // refetch (chat & storage, dengan kemungkinan dedupe query key)
    // sudah selesai sebelum kita assert label baru.
    await stub.waitForIdle();

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

    // === Post-active quiescent guard ===
    // Setelah ketiga tombol aktif, TIDAK boleh ada request tambahan
    // (polling background / refetch on-focus / interval query).
    await stub.assertQuiescent("storage", { windowMs: 1000 });
    await stub.assertQuiescent("chat", { windowMs: 1000 });

    // Terminal leak-guard event-based: konsisten dengan spec lain —
    // varian dihilangkan → cek chat + storage sekaligus. Tanpa polling;
    // subscribe ke request listener, bounded upper-bound `windowMs`.
    await stub.assertNoAdditionalRequests({
      windowMs: APK_STUB_TERMINAL_WINDOW_MS,
    });
  });
});