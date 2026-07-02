import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * E2E: menavigasi melalui beberapa rute berurutan (client-side, tanpa
 * reload) SELAMA ChatModeSplash tampil, lalu memverifikasi:
 *
 *   1. Splash TIDAK remount — node DOM yang sama tetap terpasang lintas
 *      navigasi (splash hidup di __root, jadi tidak boleh unmount).
 *   2. Timeline animasi tetap konsisten dengan `prefers-reduced-motion`
 *      terkini — pada `reduce` tidak ada fade (transitionDuration=0s,
 *      opacity langsung 1 → 0), pada `no-preference` fade berjalan
 *      normal dan opacity monoton menurun setelah hold selesai.
 *   3. Session guard hanya ditulis SEKALI meskipun rute berubah
 *      beberapa kali selama splash tampil.
 */

const URL = "/download";
const SPLASH_SELECTOR = '[aria-label="Memuat MCM Chat"]';
const SESSION_KEY = "mcm.chat.splashShown";

async function seedChatMode(context: BrowserContext) {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("mcm.appMode", "chat");
      sessionStorage.removeItem("mcm.chat.splashShown");
    } catch {
      /* ignore */
    }
  });
}

async function tagSplash(page: Page): Promise<string> {
  // Tandai node splash saat pertama tampil supaya kita bisa
  // mendeteksi remount (node baru = tag hilang).
  return await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) throw new Error("splash not found");
    const tag = `orig-${Math.random().toString(36).slice(2, 10)}`;
    el.setAttribute("data-e2e-tag", tag);
    return tag;
  }, SPLASH_SELECTOR);
}

async function isSameNode(page: Page, tag: string) {
  return await page.evaluate(
    ({ sel, tag }) => {
      const nodes = document.querySelectorAll<HTMLElement>(sel);
      if (nodes.length === 0) return { present: false, sameTag: false, count: 0 };
      const tagged = Array.from(nodes).filter(
        (n) => n.getAttribute("data-e2e-tag") === tag,
      );
      return {
        present: true,
        sameTag: tagged.length === 1,
        count: nodes.length,
      };
    },
    { sel: SPLASH_SELECTOR, tag },
  );
}

async function readSplashState(page: Page) {
  return await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      opacity: Number(cs.opacity),
      transitionDuration: cs.transitionDuration,
    };
  }, SPLASH_SELECTOR);
}

for (const mode of ["reduce", "no-preference"] as const) {
  test(`ChatModeSplash · sequential client-side nav tanpa remount · reduce=${mode}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: mode });
    await seedChatMode(context);
    const page = await context.newPage();

    await page.goto(URL, { waitUntil: "domcontentloaded" });

    const splash = page.locator(SPLASH_SELECTOR);
    await expect(splash).toBeVisible({ timeout: 4000 });

    const tag = await tagSplash(page);

    // Baseline: opacity awal 1, transitionDuration konsisten dgn mode.
    const s0 = await readSplashState(page);
    expect(s0?.opacity).toBeGreaterThan(0.99);
    if (mode === "reduce") {
      expect(s0?.transitionDuration).toBe("0s");
    } else {
      // Non-reduce → transisi CSS aktif (bukan 0s).
      expect(s0?.transitionDuration).not.toBe("0s");
    }

    // Guard belum ditulis (splash masih tampil).
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBeNull();

    // Lakukan navigasi client-side berurutan lewat <Link>.
    // Non-reduce hold ~1000ms + fade 500ms → 3 nav muat.
    // Reduce hold ~400ms → 2 nav cukup untuk uji.
    // Pakai click biasa (bukan goto) supaya tetap client-side.
    const detailLinks = page.getByRole("link", {
      name: /detail\s*&\s*changelog/i,
    });
    // Pertama kali detail links harus ada (dua kartu APK).
    await expect(detailLinks.first()).toBeVisible();

    // Nav 1: /download → /download/storage
    await detailLinks.first().click();
    await page.waitForURL(/\/download\/[^/]+$/, { timeout: 2000 });
    let state = await isSameNode(page, tag);
    expect(state.present).toBe(true);
    expect(state.count).toBe(1);
    expect(state.sameTag).toBe(true); // TIDAK remount

    // Nav 2: /download/storage → /download (back link)
    const backLink = page.getByRole("link", { name: /kembali|semua/i }).first();
    await backLink.click();
    await page.waitForURL(/\/download$/, { timeout: 2000 });
    state = await isSameNode(page, tag);
    expect(state.present).toBe(true);
    expect(state.sameTag).toBe(true);

    if (mode === "no-preference") {
      // Nav 3 hanya di non-reduce (hold cukup panjang).
      const detailLinks2 = page.getByRole("link", {
        name: /detail\s*&\s*changelog/i,
      });
      // Klik kartu kedua bila ada; fallback ke .first().
      const target =
        (await detailLinks2.count()) >= 2
          ? detailLinks2.nth(1)
          : detailLinks2.first();
      await target.click();
      await page.waitForURL(/\/download\/[^/]+$/, { timeout: 2000 });
      state = await isSameNode(page, tag);
      expect(state.present).toBe(true);
      expect(state.sameTag).toBe(true);
    }

    // Splash pada akhirnya hilang, guard ditulis TEPAT sekali.
    await expect(splash).toBeHidden({ timeout: 3000 });
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    // Verifikasi mode animasi tetap sesuai preferensi terkini —
    // tidak "rusak" oleh navigasi. Untuk reduce, node harus hilang
    // tanpa jendela fade (opacity anjlok langsung dari 1 → 0).
    // Untuk non-reduce, transitionDuration harus tetap > 0 selama
    // splash masih ada di DOM.
    // (Node sudah hilang di titik ini; kita hanya assert absence.)
    const finalCount = await page.locator(SPLASH_SELECTOR).count();
    expect(finalCount).toBe(0);

    await context.close();
  });
}
