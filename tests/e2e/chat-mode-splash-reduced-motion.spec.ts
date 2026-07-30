import { test, expect } from "@playwright/test";

/**
 * E2E: ChatModeSplash harus:
 *   1. Menghormati `prefers-reduced-motion: reduce` — tidak ada fade
 *      (transisi 0ms) dan class `motion-reduce:transition-none` selalu
 *      terpasang.
 *   2. Konsisten setelah navigasi klien: splash cuma tampil sekali per
 *      session — pindah route tanpa reload manual tidak boleh me-remount
 *      splash.
 *
 * Skenario ini berjalan di halaman publik `/download` (me-mount __root
 * sehingga <ChatModeSplash /> ikut ter-render) supaya tidak butuh login.
 */

const URL = "/download";
const SESSION_KEY = "mcm.chat.splashShown";

test.describe("ChatModeSplash · prefers-reduced-motion", () => {
  test.use({ colorScheme: "light", reducedMotion: "reduce" });

  test.beforeEach(async ({ context }) => {
    // Aktifkan mode chat SEBELUM app mount, bersihkan sessionKey supaya
    // splash benar-benar tampil pada kunjungan pertama.
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem("mcm.appMode", "chat");
        window.sessionStorage.removeItem("mcm.chat.splashShown");
      } catch {
        /* ignore */
      }
    });
  });

  test("tanpa fade saat reduced-motion & tetap konsisten setelah navigasi klien", async ({
    page,
  }) => {
    await page.goto(URL);
    await page.waitForLoadState("domcontentloaded");

    const splash = page.getByRole("status", { name: "Memuat MCM Chat" });
    await expect(splash).toBeVisible({ timeout: 4000 });

    // 1) Class motion-reduce:transition-none WAJIB ada — itu yang mematikan
    //    transisi opacity di Tailwind saat prefers-reduced-motion aktif.
    await expect(splash).toHaveClass(/motion-reduce:transition-none/);

    // 2) Computed transitionDuration harus 0s — tidak ada fade.
    const transitionDuration = await splash.evaluate(
      (el) => window.getComputedStyle(el).transitionDuration,
    );
    expect(transitionDuration).toBe("0s");

    // 3) Splash menghilang dengan cepat (hold reduced = 400ms, fade = 0ms).
    await expect(splash).toBeHidden({ timeout: 3000 });

    // 4) Session guard tersimpan setelah splash selesai.
    const stored = await page.evaluate(
      (k) => window.sessionStorage.getItem(k),
      SESSION_KEY,
    );
    expect(stored).toBe("1");

    // 5) Konsistensi: navigasi klien ke rute publik lain TIDAK boleh
    //    memicu splash lagi. Pakai router client-side (History API +
    //    dispatchEvent popstate → TanStack Router menangani) via anchor
    //    yang sudah ada di halaman /download; kalau tidak ada, fallback
    //    ke pushState manual.
    await page.evaluate(() => {
      window.history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    // Beri kesempatan __root remount / effect ulang berjalan.
    await page.waitForTimeout(200);
    await expect(splash).toHaveCount(0);

    // 6) Kembali ke /download juga tidak boleh memicu splash lagi
    //    (session guard masih berlaku selama tab hidup).
    await page.evaluate(() => {
      window.history.pushState({}, "", "/download");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.waitForTimeout(200);
    await expect(
      page.getByRole("status", { name: "Memuat MCM Chat" }),
    ).toHaveCount(0);
  });
});