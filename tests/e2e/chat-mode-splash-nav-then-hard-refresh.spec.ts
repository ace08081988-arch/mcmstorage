import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * E2E: navigasi client-side berurutan saat ChatModeSplash tampil,
 * dilanjutkan hard refresh (`page.reload()`), lalu verifikasi:
 *
 *   Skenario A — reload SEBELUM guard tertulis:
 *     Splash harus tampil ulang PADA FRAME PERTAMA post-reload dengan
 *     opacity ≈ 1 (tidak boleh fade-in dari 0). Timeline sesuai
 *     preferensi terkini (transitionDuration=0s untuk reduce,
 *     non-0s untuk no-preference). Guard tertulis tepat sekali
 *     setelah splash pasca-reload selesai.
 *
 *   Skenario B — reload SETELAH guard tertulis:
 *     Splash TIDAK tampil sama sekali post-reload. Tidak ada
 *     flash / render sekilas / node yang sempat masuk-lalu-hilang.
 *
 * Keduanya dijalankan untuk `reduce` dan `no-preference`.
 */

const URL = "/download";
const SPLASH_SELECTOR = '[aria-label="Memuat MCM Chat"]';
const SESSION_KEY = "mcm.chat.splashShown";

async function seedChatMode(context: BrowserContext) {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("mcm.appMode", "chat");
    } catch {
      /* ignore */
    }
  });
}

async function clearGuardOnce(page: Page) {
  await page.addInitScript(() => {
    try {
      sessionStorage.removeItem("mcm.chat.splashShown");
    } catch {
      /* ignore */
    }
  });
}

/** Merekam apakah splash pernah muncul dalam window observasi + opacity awal. */
async function watchSplashDuringLoad(page: Page, durationMs: number) {
  return await page.evaluate(async (dur) => {
    const seen: Array<{ t: number; present: boolean; op: number | null; td: string | null }> = [];
    const start = performance.now();
    while (performance.now() - start < dur) {
      const el = document.querySelector<HTMLElement>(
        '[aria-label="Memuat MCM Chat"]',
      );
      const cs = el ? getComputedStyle(el) : null;
      seen.push({
        t: Math.round(performance.now() - start),
        present: !!el,
        op: cs ? Number(cs.opacity) : null,
        td: cs ? cs.transitionDuration : null,
      });
      await new Promise((r) => setTimeout(r, 16));
    }
    return seen;
  }, durationMs);
}

for (const mode of ["reduce", "no-preference"] as const) {
  test(`ChatModeSplash · nav berurutan + hard refresh SEBELUM guard · reduce=${mode}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: mode });
    await seedChatMode(context);
    const page = await context.newPage();
    await clearGuardOnce(page);

    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await expect(page.locator(SPLASH_SELECTOR)).toBeVisible({ timeout: 4000 });

    // Nav 1 (client-side).
    await page
      .getByRole("link", { name: /detail\s*&\s*changelog/i })
      .first()
      .click();
    await page.waitForURL(/\/download\/[^/]+$/, { timeout: 2000 });
    // Nav 2 kembali.
    await page.getByRole("link", { name: /kembali|semua/i }).first().click();
    await page.waitForURL(/\/download$/, { timeout: 2000 });

    // Pastikan guard BELUM tertulis (splash masih di dalam window hold+fade).
    const guardBefore = await page.evaluate(
      (k) => sessionStorage.getItem(k),
      SESSION_KEY,
    );
    expect(guardBefore).toBeNull();

    // Hard refresh.
    await page.reload({ waitUntil: "domcontentloaded" });

    // Tangkap frame-frame awal untuk mendeteksi fade-in salah.
    const trace = await watchSplashDuringLoad(page, 300);

    // Frame pertama saat splash present harus opacity ≈ 1 (bukan
    // fade-in dari 0).
    const firstPresent = trace.find((s) => s.present);
    expect(firstPresent).toBeTruthy();
    expect(firstPresent!.op ?? 0).toBeGreaterThan(0.99);

    // transitionDuration sesuai preferensi terkini.
    if (mode === "reduce") {
      expect(firstPresent!.td).toBe("0s");
    } else {
      expect(firstPresent!.td).not.toBe("0s");
    }

    // Splash akhirnya hilang & guard tertulis sekali.
    await expect(page.locator(SPLASH_SELECTOR)).toBeHidden({ timeout: 3500 });
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    await context.close();
  });

  test(`ChatModeSplash · nav berurutan + hard refresh SETELAH guard · reduce=${mode}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: mode });
    await seedChatMode(context);
    const page = await context.newPage();
    await clearGuardOnce(page);

    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await expect(page.locator(SPLASH_SELECTOR)).toBeVisible({ timeout: 4000 });

    // Sequence nav berurutan.
    await page
      .getByRole("link", { name: /detail\s*&\s*changelog/i })
      .first()
      .click();
    await page.waitForURL(/\/download\/[^/]+$/, { timeout: 2000 });

    // Tunggu splash selesai + guard tertulis.
    await expect(page.locator(SPLASH_SELECTOR)).toBeHidden({ timeout: 3500 });
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    // Hard refresh SETELAH guard.
    await page.reload({ waitUntil: "domcontentloaded" });

    // Rekam window observasi cukup panjang — TIDAK BOLEH ada frame
    // di mana splash sempat present (flash) walau sekejap.
    const trace = await watchSplashDuringLoad(page, 500);
    const everPresent = trace.some((s) => s.present);
    expect(everPresent).toBe(false);

    // Guard tetap "1" (tidak double-tulis / reset).
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    await context.close();
  });
}
