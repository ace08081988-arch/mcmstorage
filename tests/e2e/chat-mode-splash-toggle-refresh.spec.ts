import { test, expect } from "@playwright/test";

/**
 * E2E: toggle `prefers-reduced-motion` saat splash tampil, LALU refresh
 * halaman. Setelah reload, splash harus konsisten dengan preferensi
 * terkini — tidak ada residu animasi dari sesi sebelumnya, tidak ada
 * fade yang salah, dan session guard berperilaku benar (splash tidak
 * muncul kembali jika guard sudah tertulis).
 */

const URL = "/download";
const SESSION_KEY = "mcm.chat.splashShown";
const SPLASH_NAME = "Memuat MCM Chat";

async function seedChatMode(context: import("@playwright/test").BrowserContext) {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("mcm.appMode", "chat");
    } catch {
      /* ignore */
    }
  });
}

test.describe("ChatModeSplash · toggle reduce-motion lalu refresh", () => {
  test("toggle mid-splash SEBELUM guard tertulis, refresh → splash tampil ulang dengan timeline reduce terbaru", async ({
    browser,
  }) => {
    // Mulai dengan full motion. Splash butuh ≥1000ms sebelum menulis
    // guard, jadi kita punya jendela untuk refresh.
    const context = await browser.newContext({ reducedMotion: "no-preference" });
    await seedChatMode(context);
    const page = await context.newPage();

    // Bersihkan guard supaya splash muncul.
    await page.addInitScript(() => {
      try {
        sessionStorage.removeItem("mcm.chat.splashShown");
      } catch {
        /* ignore */
      }
    });

    await page.goto(URL);
    await page.waitForLoadState("domcontentloaded");

    const splash = page.getByRole("status", { name: SPLASH_NAME });
    await expect(splash).toBeVisible({ timeout: 4000 });

    // Toggle ke reduce di tengah hold (~300ms).
    await page.waitForTimeout(300);
    await page.emulateMedia({ reducedMotion: "reduce" });

    // Refresh SEBELUM splash selesai (guard belum tertulis).
    // Verifikasi dulu bahwa guard memang belum tertulis.
    const guardBeforeReload = await page.evaluate(
      (k) => sessionStorage.getItem(k),
      SESSION_KEY,
    );
    expect(guardBeforeReload).toBeNull();

    await page.reload({ waitUntil: "domcontentloaded" });

    // Setelah reload, media state = reduce (context masih reduce).
    const splash2 = page.getByRole("status", { name: SPLASH_NAME });
    await expect(splash2).toBeVisible({ timeout: 4000 });

    // Marker Tailwind harus ada.
    await expect(splash2).toHaveClass(/motion-reduce:transition-none/);
    // Computed transitionDuration = 0s → tidak ada fade CSS.
    expect(
      await splash2.evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe("0s");

    // Timeline reduce (400ms) → hilang cepat, konsisten dengan
    // preferensi terbaru (bukan menggunakan timeline lama dari
    // mount sebelum refresh).
    await expect(splash2).toBeHidden({ timeout: 2000 });

    // Guard tertulis tepat sekali setelah splash pasca-reload selesai.
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    await context.close();
  });

  test("toggle SETELAH guard tertulis, refresh → splash TIDAK muncul lagi & tidak ada residu fade", async ({
    browser,
  }) => {
    // Mulai reduce supaya guard tertulis cepat (400ms).
    const context = await browser.newContext({ reducedMotion: "reduce" });
    await seedChatMode(context);
    const page = await context.newPage();
    await page.addInitScript(() => {
      try {
        sessionStorage.removeItem("mcm.chat.splashShown");
      } catch {
        /* ignore */
      }
    });

    await page.goto(URL);
    await page.waitForLoadState("domcontentloaded");

    const splash = page.getByRole("status", { name: SPLASH_NAME });
    await expect(splash).toBeVisible({ timeout: 4000 });
    // Tunggu sampai splash selesai → guard tertulis.
    await expect(splash).toBeHidden({ timeout: 3000 });
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    // Toggle preferensi ke no-preference, lalu refresh.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload({ waitUntil: "domcontentloaded" });

    // Guard masih ada (sessionStorage bertahan lintas reload) →
    // splash tidak boleh muncul lagi, meski preferensi berubah.
    // Beri window observasi cukup panjang untuk mendeteksi flicker.
    const observed = await page.evaluate(async () => {
      const seen: string[] = [];
      const check = () => {
        const el = document.querySelector<HTMLElement>(
          '[aria-label="Memuat MCM Chat"]',
        );
        seen.push(el ? "present" : "absent");
      };
      for (let i = 0; i < 20; i++) {
        check();
        await new Promise((r) => setTimeout(r, 50));
      }
      return seen;
    });
    // Tidak ada "present" sama sekali → splash tidak dirender lagi
    // dan tidak ada residu animasi.
    expect(observed.every((v) => v === "absent")).toBe(true);

    // Guard tetap "1", tidak double-tulis.
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    await context.close();
  });
});
