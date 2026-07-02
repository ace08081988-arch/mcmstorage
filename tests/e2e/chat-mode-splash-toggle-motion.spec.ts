import { test, expect } from "@playwright/test";

/**
 * E2E: mengubah `prefers-reduced-motion` SAAT splash sedang tampil.
 *
 * Kontrak yang diverifikasi:
 *  - Timeline JS splash (hold + fade) ditentukan pada saat mount dan
 *    TIDAK terpengaruh oleh perubahan media query di tengah jalan —
 *    jadi tidak ada fade yang tiba-tiba muncul/menghilang secara
 *    janggal saat OS/settings user berubah.
 *  - Tailwind variant `motion-reduce:transition-none` tetap responsif
 *    lewat CSS (computed transitionDuration mengikuti media query
 *    terkini), sehingga UI tidak menghasilkan animasi opacity yang
 *    salah ketika reduce diaktifkan mid-splash.
 *
 * Halaman `/download` dipakai karena publik dan me-mount __root
 * (tempat <ChatModeSplash /> hidup).
 */

const URL = "/download";
const SESSION_KEY = "mcm.chat.splashShown";
const SPLASH_NAME = "Memuat MCM Chat";

async function seedChatMode(context: import("@playwright/test").BrowserContext) {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("mcm.appMode", "chat");
      window.sessionStorage.removeItem("mcm.chat.splashShown");
    } catch {
      /* ignore */
    }
  });
}

test.describe("ChatModeSplash · toggle prefers-reduced-motion mid-splash", () => {
  test("reduce → no-preference saat splash tampil: tidak ada fade yang salah", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    await seedChatMode(context);
    const page = await context.newPage();
    await page.goto(URL);
    await page.waitForLoadState("domcontentloaded");

    const splash = page.getByRole("status", { name: SPLASH_NAME });
    await expect(splash).toBeVisible({ timeout: 4000 });

    // Marker Tailwind tetap ada.
    await expect(splash).toHaveClass(/motion-reduce:transition-none/);
    // Awalnya reduce → transitionDuration 0s.
    expect(
      await splash.evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe("0s");

    // Toggle OS → no-preference di tengah hold. CSS boleh berubah,
    // TAPI splash tidak boleh mendadak memasuki fase fade — timeline
    // JS reduce (hold 400ms + fade 0ms) sudah terjadwal.
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // Node harus TETAP terlihat sebentar (masih di dalam window 400ms
    // sejak mount), tapi tidak boleh mendapat class `opacity-0` yang
    // baru — karena scheduler fase fade tidak dipicu ulang.
    const classAfterToggle = await splash.getAttribute("class");
    expect(classAfterToggle ?? "").not.toContain("opacity-0");

    // Splash tetap hilang cepat (≤3s) — tidak "nyangkut" karena toggle.
    await expect(splash).toBeHidden({ timeout: 3000 });

    // Session guard tetap tercatat sekali.
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    await context.close();
  });

  test("no-preference → reduce saat splash tampil: fade tetap berjalan penuh, tidak dipotong", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "no-preference" });
    await seedChatMode(context);
    const page = await context.newPage();
    await page.goto(URL);
    await page.waitForLoadState("domcontentloaded");

    const splash = page.getByRole("status", { name: SPLASH_NAME });
    await expect(splash).toBeVisible({ timeout: 4000 });

    // Awal: full motion → transitionDuration 500ms.
    expect(
      await splash.evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe("0.5s");

    // Toggle reduce mid-hold (~300ms sejak mount). Tailwind akan
    // memaksa transitionDuration ke 0s via `motion-reduce`, tapi
    // splash TIDAK boleh langsung menghilang — hold 1000ms JS masih
    // berjalan.
    await page.waitForTimeout(300);
    await page.emulateMedia({ reducedMotion: "reduce" });

    // Setelah toggle, computed style ikut media query terkini.
    expect(
      await splash.evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe("0s");

    // Masih terlihat pada ~800ms total (belum melewati hold 1000ms).
    await page.waitForTimeout(500);
    await expect(splash).toBeVisible();
    // Belum masuk fase fade JS — kelas opacity-0 belum diaplikasikan.
    const midClass = await splash.getAttribute("class");
    expect(midClass ?? "").not.toContain("opacity-0");

    // Lewati hold → masuk fase fade. Kelas opacity-0 muncul, walau
    // transisi CSS-nya 0s (karena reduce sudah aktif) — tidak ada
    // "fade yang salah", cuma hilang tanpa animasi.
    await page.waitForTimeout(400); // total ~1200ms
    // Splash mungkin sudah unmount (fade 0s → langsung dilanjut ke
    // unmount 500ms setelahnya). Terima dua kondisi: masih ada dgn
    // opacity-0, atau sudah hilang. Yang penting tidak "nyangkut".
    const stillThere = await splash.count();
    if (stillThere > 0) {
      const fadeClass = await splash.getAttribute("class");
      expect(fadeClass ?? "").toContain("opacity-0");
    }

    // Bagaimanapun harus benar-benar hilang dalam total timeline
    // maksimum (hold 1000 + fade 500 + slack).
    await expect(splash).toBeHidden({ timeout: 3000 });

    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    await context.close();
  });
});
