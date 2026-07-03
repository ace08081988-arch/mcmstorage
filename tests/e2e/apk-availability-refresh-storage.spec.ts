import { test, expect, type Route } from "@playwright/test";

/**
 * E2E khusus tombol <DownloadStorageApkShortcut>: alur ketersediaan APK
 * Storage secara terisolasi (independen dari varian Chat / tombol copy).
 *
 *   1. Server function `getApkVariantDetail` awalnya mengembalikan
 *      rilis kosong → tombol Storage tampil idle "Belum tersedia"
 *      dengan ikon refresh terlihat, tanpa toast merah.
 *   2. Setelah flag test dibalik (rilis Storage tersedia), mengetuk
 *      ikon refresh memicu refetch dan tombol berganti ke state aktif
 *      dengan label PERSIS "Unduh APK Storage".
 *
 * Harness publik: /lovable/visual/apk-availability-shortcuts (no-auth).
 */

const URL = "/lovable/visual/apk-availability-shortcuts";

type ApkRelease = {
  name: string;
  url: string;
  sizeMB: number | null;
  updatedAt: string | null;
  versionName: string | null;
  versionCode: number | null;
  belowMinimum: boolean;
};

function makeStorageRelease(): ApkRelease {
  return {
    name: "MCM-Storage-1.0.0.apk",
    url: "https://example.test/MCM-Storage-1.0.0.apk",
    sizeMB: 12,
    updatedAt: "2026-07-03T00:00:00.000Z",
    versionName: "1.0.0",
    versionCode: 1,
    belowMinimum: false,
  };
}

function makeDetail(
  variant: "chat" | "storage",
  releases: ApkRelease[],
): Record<string, unknown> {
  return {
    variant,
    title: variant === "chat" ? "MCM Chat" : "MCM Storage",
    subtitle: "Harness stub.",
    latest: releases[0] ?? null,
    releases,
    changelog: null,
    minSupported: null,
  };
}

test.describe("APK availability · storage shortcut refresh flow", () => {
  test("storage: belum tersedia → tap refresh → aktif 'Unduh APK Storage'", async ({
    page,
  }) => {
    // Flag dikontrol dari luar handler supaya bisa diflip di tengah test.
    let storageAvailable = false;

    await page.route("**/_serverFn/**", async (route: Route) => {
      const req = route.request();
      const url = req.url();
      let raw = decodeURIComponent(url.split("?")[1] ?? "");
      if (!raw && req.method() === "POST") {
        raw = req.postData() ?? "";
      }
      const variant: "chat" | "storage" = raw.includes("storage")
        ? "storage"
        : "chat";

      // Varian Chat tetap kosong sepanjang test — kita hanya menguji
      // Storage dan sekaligus memastikan alurnya independen (state Chat
      // tidak ikut berubah saat tombol Storage di-refresh).
      const releases =
        variant === "storage" && storageAvailable ? [makeStorageRelease()] : [];

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeDetail(variant, releases)),
      });
    });

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

    // === Balik flag Storage saja → tap refresh Storage ===
    storageAvailable = true;
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
    // Kontrol respons per-fase: fase 1 (initial load) fulfill langsung
    // dengan releases kosong. Fase 2 (setelah tap refresh) tahan
    // respons sampai test siap merilisnya, supaya assertion state
    // checking/busy sempat terobservasi sebelum data masuk.
    let phase: "initial" | "holding" = "initial";
    let releaseNext: (() => void) | null = null;
    const heldGate = new Promise<void>((resolve) => {
      releaseNext = resolve;
    });

    await page.route("**/_serverFn/**", async (route: Route) => {
      const req = route.request();
      const url = req.url();
      let raw = decodeURIComponent(url.split("?")[1] ?? "");
      if (!raw && req.method() === "POST") {
        raw = req.postData() ?? "";
      }
      const variant: "chat" | "storage" = raw.includes("storage")
        ? "storage"
        : "chat";

      // Chat tetap kosong sepanjang test — fokus pada varian storage.
      if (variant !== "storage") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(makeDetail("chat", [])),
        });
        return;
      }

      if (phase === "initial") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(makeDetail("storage", [])),
        });
        return;
      }
      // phase === "holding": tunda respons sampai test membuka gate,
      // baru fulfill dengan rilis tersedia.
      await heldGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeDetail("storage", [makeStorageRelease()])),
      });
    });

    await page.goto(URL);

    const storageDl = page.getByTestId("apk-shortcut-download-storage");

    // Fase awal: idle "Belum tersedia".
    await expect(storageDl.getByText("Belum tersedia")).toBeVisible();

    const storageRefresh = storageDl.getByRole("button", {
      name: /Cek ulang ketersediaan APK MCM Storage/i,
    });
    await expect(storageRefresh).toBeVisible();
    await expect(storageRefresh).toBeEnabled();

    // Balik ke fase holding SEBELUM tap — respons refetch akan ditahan.
    phase = "holding";
    await storageRefresh.click();

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
    releaseNext?.();

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