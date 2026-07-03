import { test, expect, type Route } from "@playwright/test";

/**
 * E2E: verifikasi `aria-label` <CopyChatApkLinksButton variant="shortcut">
 * di setiap state (per spesifikasi komponen):
 *
 *   1. Idle · belum tersedia
 *      → "APK MCM Chat belum tersedia — ketuk untuk cek ulang"
 *   2. Disabled · checking (isFetching setelah tap refresh/main)
 *      → "Memeriksa ketersediaan APK MCM Chat, tombol dinonaktifkan sementara"
 *      + attribute `disabled`
 *   3. Idle · tersedia (siap salin)
 *      → "Salin semua link APK Chat"
 *   4. Disabled · busy (proses menyalin, fetchDetail dalam onClick)
 *      → "Memproses: menyalin semua link APK MCM Chat, tombol dinonaktifkan sementara"
 *      + attribute `disabled`
 *   5. Aktif · tersalin
 *      → "Tersalin: semua link APK MCM Chat sudah disalin ke clipboard"
 *
 * Semua state diverifikasi lewat harness publik no-auth
 * /lovable/visual/apk-availability-shortcuts dengan stub server-fn
 * berbasis gate yang dapat ditahan/dilepas dari sisi test.
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

function makeRelease(): ApkRelease {
  return {
    name: "MCM-Chat-1.0.0.apk",
    url: "https://example.test/MCM-Chat-1.0.0.apk",
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

test.describe("CopyChatApkLinksButton · aria-label per state", () => {
  test("idle → checking(disabled) → tersedia → busy(disabled) → tersalin", async ({
    page,
    context,
  }) => {
    // Beri izin clipboard supaya `navigator.clipboard.writeText` pada
    // state "busy → tersalin" berhasil di sisi Chromium.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    let chatReleases: ApkRelease[] = [];
    let holdChat: Promise<void> | null = null;
    let releaseHold: (() => void) | null = null;

    function armHold() {
      holdChat = new Promise<void>((resolve) => {
        releaseHold = () => {
          const prev = holdChat;
          holdChat = null;
          releaseHold = null;
          resolve();
          void prev;
        };
      });
    }

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

      if (variant !== "chat") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(makeDetail("storage", [])),
        });
        return;
      }

      if (holdChat) await holdChat;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeDetail("chat", chatReleases)),
      });
    });

    await page.goto(URL);

    const wrapper = page.getByTestId("apk-shortcut-copy-chat-links");
    // Tombol utama = tombol dalam wrapper yang bertipe `flex flex-col`
    // (bukan tombol ikon refresh). Kita target lewat aria-label yang
    // per-state selalu unik.
    const mainByAria = (name: RegExp) =>
      wrapper.getByRole("button", { name });

    // ============ (1) Idle · belum tersedia ============
    await expect(
      mainByAria(
        /^APK MCM Chat belum tersedia — ketuk untuk cek ulang$/,
      ),
    ).toBeVisible();
    // Idle-unavailable: tombol utama TIDAK disabled (agar bisa ditap
    // untuk memicu refetch); hanya busy/checking yang men-disable.
    await expect(
      mainByAria(
        /^APK MCM Chat belum tersedia — ketuk untuk cek ulang$/,
      ),
    ).toBeEnabled();

    // ============ (2) Disabled · checking ============
    // Tahan respons chat, lalu tap tombol utama → memicu
    // `availability.refetch()` (karena !isAvailable). Selama refetch
    // berjalan, isFetching = true → aria-label harus berubah ke
    // state "Memeriksa…".
    chatReleases = [makeRelease()];
    armHold();
    await mainByAria(
      /^APK MCM Chat belum tersedia — ketuk untuk cek ulang$/,
    ).click();

    const checkingLabel =
      /^Memeriksa ketersediaan APK MCM Chat, tombol dinonaktifkan sementara$/;
    await expect(mainByAria(checkingLabel)).toBeVisible();
    await expect(mainByAria(checkingLabel)).toBeDisabled();
    // Guard: label idle/aktif tidak bocor ke state checking.
    await expect(
      mainByAria(/^Salin semua link APK Chat$/),
    ).toHaveCount(0);
    await expect(
      mainByAria(
        /^APK MCM Chat belum tersedia — ketuk untuk cek ulang$/,
      ),
    ).toHaveCount(0);

    // ============ (3) Idle · tersedia ============
    releaseHold?.();
    const idleAvailableLabel = /^Salin semua link APK Chat$/;
    await expect(mainByAria(idleAvailableLabel)).toBeVisible();
    await expect(mainByAria(idleAvailableLabel)).toBeEnabled();

    // ============ (4) Disabled · busy (menyalin) ============
    // Tahan respons chat lagi, tap tombol utama → onClick akan
    // memanggil fetchDetail sebelum menulis clipboard; selama request
    // digantung, busy=true → aria-label harus berubah ke state
    // "Memproses…" dan tombol disabled.
    armHold();
    await mainByAria(idleAvailableLabel).click();

    const busyLabel =
      /^Memproses: menyalin semua link APK MCM Chat, tombol dinonaktifkan sementara$/;
    await expect(mainByAria(busyLabel)).toBeVisible();
    await expect(mainByAria(busyLabel)).toBeDisabled();
    // Guard: bukan lagi label "Memeriksa…" (query sudah cache-hit,
    // bukan isFetching).
    await expect(mainByAria(checkingLabel)).toHaveCount(0);

    // ============ (5) Aktif · tersalin ============
    releaseHold?.();
    const copiedLabel =
      /^Tersalin: semua link APK MCM Chat sudah disalin ke clipboard$/;
    // `copied` di-reset setelah 2 detik — assertion default (5s) cukup
    // untuk menangkap window ini; batasi timeout eksplisit supaya
    // regresi (label tidak pernah muncul) gagal cepat.
    await expect(mainByAria(copiedLabel)).toBeVisible({ timeout: 3000 });
    // Clipboard benar-benar berisi header + baris versi.
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("MCM Chat APK — daftar unduhan");
    expect(clip).toContain("https://example.test/MCM-Chat-1.0.0.apk");
  });
});