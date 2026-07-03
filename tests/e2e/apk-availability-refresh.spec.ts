import { test, expect, type Route } from "@playwright/test";

/**
 * E2E: alur pengecekan ulang ketersediaan APK pada tiga tombol pintas
 * di /lovable/visual/apk-availability-shortcuts:
 *
 *   1. Kondisi awal: server function `getApkVariantDetail` mengembalikan
 *      rilis kosong → tombol tampil idle "Belum tersedia" dengan ikon
 *      refresh terlihat, tanpa toast merah.
 *   2. Setelah rilis muncul di sisi server (flag test dibalik), mengetuk
 *      ikon refresh memicu refetch dan tombol otomatis berganti ke
 *      state aktif dengan label unduhan/salin yang jelas.
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

function makeRelease(variant: "chat" | "storage"): ApkRelease {
  const label = variant === "chat" ? "MCM-Chat" : "MCM-Storage";
  return {
    name: `${label}-1.0.0.apk`,
    url: `https://example.test/${label}-1.0.0.apk`,
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

test.describe("APK availability · refresh flow", () => {
  test("belum tersedia → tap refresh → aktif", async ({ page }) => {
    // Flag dikontrol dari luar handler supaya bisa diflip di tengah test.
    let available = false;

    await page.route("**/_serverFn/**", async (route: Route) => {
      // Deteksi varian dari query string payload (GET) atau body (POST).
      const req = route.request();
      const url = req.url();
      let raw = decodeURIComponent(url.split("?")[1] ?? "");
      if (!raw && req.method() === "POST") {
        raw = req.postData() ?? "";
      }
      const variant: "chat" | "storage" = raw.includes("storage")
        ? "storage"
        : "chat";

      const releases = available ? [makeRelease(variant)] : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeDetail(variant, releases)),
      });
    });

    await page.goto(URL);

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

    // === Balik flag → rilis kini tersedia; tap refresh memicu refetch ===
    available = true;

    await chatRefresh.click();
    await storageRefresh.click();
    await copyRefresh.click();

    // Tombol otomatis aktif — label ganti ke aksi utama, ikon refresh hilang.
    await expect(chatDl.getByText("Unduh APK Chat")).toBeVisible();
    await expect(storageDl.getByText("Unduh APK Storage")).toBeVisible();
    await expect(copyChat.getByText("Salin link APK Chat")).toBeVisible();

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