import { test, expect } from "@playwright/test";
import { installApkStub, makeRelease } from "./_apk-availability-stub";

/**
 * E2E khusus tombol <DownloadStorageApkShortcut>: alur ketersediaan APK
 * Storage secara terisolasi (independen dari varian Chat / tombol copy).
 *
 *   1. Server function `getApkVariantDetail` awalnya mengembalikan
 *      rilis kosong → tombol Storage tampil idle "Belum tersedia"
 *      dengan ikon refresh terlihat, tanpa toast merah.
 *   2. Setelah respons "tersedia" di-enqueue via `installApkStub`
 *      (deterministik — bukan flag yang di-flip di tengah test),
 *      mengetuk ikon refresh memicu refetch dan tombol berganti ke
 *      state aktif dengan label PERSIS "Unduh APK Storage".
 *
 * Harness publik: /lovable/visual/apk-availability-shortcuts (no-auth).
 */

const URL = "/lovable/visual/apk-availability-shortcuts";

function makeStorageRelease() {
  return makeRelease("storage");
}

test.describe("APK availability · storage shortcut refresh flow", () => {
  test("storage: belum tersedia → tap refresh → aktif 'Unduh APK Storage'", async ({
    page,
  }) => {
    // Deterministik: setiap respons di-enqueue eksplisit lewat helper
    // shared. Handler menunggu antrian sebelum menjawab, sehingga
    // tidak ada race antara "ubah flag" dan "kirim request".
    const stub = await installApkStub(page);
    // Fetch awal (mount): kedua varian kosong. Varian Chat sengaja
    // dibiarkan kosong sepanjang test untuk assert independensi query.
    stub.primeInitial();
    stub.assertPrimed();
    await page.goto(URL);

    const storageDl = page.getByTestId("apk-shortcut-download-storage");
    const chatDl = page.getByTestId("apk-shortcut-download-chat");

    // === State awal: Storage idle "Belum tersedia" ===
    await expect(storageDl.getByText("Belum tersedia")).toBeVisible();

    // Tidak ada toast error/banner merah — rilis kosong = neutral idle.
    await expect(page.getByText(/Gagal/i)).toHaveCount(0);

    // Ikon refresh Storage terlihat.
    const storageRefresh = storageDl.getByRole("button", {
      name: /Cek ulang ketersediaan APK MCM Storage/i,
    });
    await expect(storageRefresh).toBeVisible();

    // === Enqueue respons "tersedia" untuk refetch berikutnya, LALU
    // tap. Karena handler menunggu antrian, request dijamin dibalas
    // dengan payload yang benar tanpa bergantung wall-clock.
    stub.enqueue("storage", [makeStorageRelease()]);
    await storageRefresh.click();

    // Tombol aktif — label PERSIS "Unduh APK Storage" (exact match).
    await expect(
      storageDl.getByText("Unduh APK Storage", { exact: true }),
    ).toBeVisible();

    // Cross-variant guard: wrapper Storage tidak boleh memuat kata "Chat".
    await expect(storageDl.getByText(/Chat/i)).toHaveCount(0);

    // State idle sudah hilang dari tombol Storage.
    await expect(storageDl.getByText("Belum tersedia")).toHaveCount(0);
    await expect(
      storageDl.getByRole("button", {
        name: /Cek ulang ketersediaan APK MCM Storage/i,
      }),
    ).toHaveCount(0);

    // Independensi: tombol Chat harus TETAP idle karena flag Chat tidak
    // pernah diubah. Membuktikan tap refresh Storage hanya memengaruhi
    // query varian Storage, bukan varian lain.
    await expect(chatDl.getByText("Belum tersedia")).toBeVisible();
    await expect(
      chatDl.getByRole("button", {
        name: /Cek ulang ketersediaan APK MCM Chat/i,
      }),
    ).toBeVisible();
  });

  test("storage: tap refresh → label 'Memeriksa…' & tombol refresh disabled sampai rilis tersedia", async ({
    page,
  }) => {
    // Semua stubbing lewat helper bersama — pola: enqueue awal SEBELUM
    // goto, lalu tunda enqueue refetch sampai state "Memeriksa…"
    // terobservasi. Handler menahan waiter storage selama antrian
    // kosong, memberi jendela deterministik untuk assertion busy.
    const stub = await installApkStub(page);
    stub.primeInitial();
    stub.assertPrimed();
    await page.goto(URL);

    const storageDl = page.getByTestId("apk-shortcut-download-storage");

    // Fase awal: idle "Belum tersedia".
    // Tunggu event served untuk kedua fetch awal SEBELUM assertion UI
    // — mencegah race di mana "Belum tersedia" belum sempat render.
    await stub.waitForServed("chat", 1);
    await stub.waitForServed("storage", 1);
    await expect(storageDl.getByText("Belum tersedia")).toBeVisible();

    const storageRefresh = storageDl.getByRole("button", {
      name: /Cek ulang ketersediaan APK MCM Storage/i,
    });
    await expect(storageRefresh).toBeVisible();
    await expect(storageRefresh).toBeEnabled();

    // Jangan enqueue dulu — handler akan menahan waiter storage sampai
    // test siap merilis, sehingga state "Memeriksa…" bisa diobservasi.
    await storageRefresh.click();

    // Sinkronisasi deterministik: tunggu event "waiter tertahan" dari
    // handler. Setelah event ini firing, kita 100% yakin request
    // refetch storage sudah sampai di handler dan sedang digantung —
    // aman untuk mengukur state UI berikutnya tanpa polling wall-clock.
    await stub.waitForHold("storage");

    // === State checking/busy tervalidasi ===
    // Label utama berubah menjadi "Memeriksa…" (bukan "Belum tersedia",
    // bukan "Unduh APK Storage").
    await expect(
      storageDl.getByText("Memeriksa…", { exact: true }),
    ).toBeVisible();
    await expect(
      storageDl.getByText("Mengecek rilis terbaru…", { exact: true }),
    ).toBeVisible();
    await expect(storageDl.getByText("Belum tersedia")).toHaveCount(0);
    await expect(
      storageDl.getByText("Unduh APK Storage", { exact: true }),
    ).toHaveCount(0);

    // Tombol refresh TETAP terlihat & DISABLED (disabled={isChecking})
    // — user tidak bisa memicu refetch ganda selama pengecekan berjalan.
    await expect(storageRefresh).toBeVisible();
    await expect(storageRefresh).toBeDisabled();

    // Tombol utama saat pengecekan wajib memakai aria-label khusus,
    // bukan label unduh — mencegah state "aktif palsu".
    await expect(
      storageDl.getByRole("button", {
        name: /Memeriksa ketersediaan APK MCM Storage/i,
      }),
    ).toBeVisible();
    await expect(
      storageDl.getByRole("button", { name: /^Unduh APK MCM Storage$/i }),
    ).toHaveCount(0);

    // === Rilis dirilis → tombol menjadi aktif ===
    stub.enqueue("storage", [makeStorageRelease()]);

    await expect(
      storageDl.getByText("Unduh APK Storage", { exact: true }),
    ).toBeVisible();
    // Setelah aktif, ikon refresh sudah tidak dirender lagi (hanya
    // muncul saat isUnavailable), jadi tombol utama tidak lagi disabled.
    await expect(
      storageDl.getByRole("button", {
        name: /Cek ulang ketersediaan APK MCM Storage/i,
      }),
    ).toHaveCount(0);
    await expect(storageDl.getByText("Memeriksa…")).toHaveCount(0);
  });
});