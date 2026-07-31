import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * E2E: melakukan navigasi browser back / forward SELAMA ChatModeSplash
 * tampil (tanpa reload) dan memverifikasi:
 *
 *   1. Splash TIDAK remount — node DOM yang sama (ditandai via
 *      `data-e2e-tag`) tetap terpasang lintas popstate/back/forward.
 *      Splash hidup di __root, jadi seharusnya tidak pernah unmount.
 *   2. Timeline animasi tetap konsisten dengan `prefers-reduced-motion`
 *      terkini (transitionDuration=0s pada reduce, > 0s pada
 *      no-preference) — nilai tidak "rusak" karena popstate.
 *   3. Session guard ditulis TEPAT sekali meskipun histori berpindah
 *      beberapa kali saat splash masih tampil.
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
  return await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) throw new Error("splash not found");
    const tag = `orig-${Math.random().toString(36).slice(2, 10)}`;
    el.setAttribute("data-e2e-tag", tag);
    return tag;
  }, SPLASH_SELECTOR);
}

async function inspectSplash(page: Page, tag: string) {
  return await page.evaluate(
    ({ sel, tag }) => {
      const nodes = document.querySelectorAll<HTMLElement>(sel);
      if (nodes.length === 0)
        return { present: false, sameTag: false, count: 0, td: null, op: null };
      const el = nodes[0];
      const cs = getComputedStyle(el);
      return {
        present: true,
        sameTag: el.getAttribute("data-e2e-tag") === tag,
        count: nodes.length,
        td: cs.transitionDuration,
        op: Number(cs.opacity),
      };
    },
    { sel: SPLASH_SELECTOR, tag },
  );
}

for (const mode of ["reduce", "no-preference"] as const) {
  test(`ChatModeSplash · back/forward tanpa remount · reduce=${mode}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: mode });
    await seedChatMode(context);
    const page = await context.newPage();

    await page.goto(URL, { waitUntil: "domcontentloaded" });

    const splash = page.locator(SPLASH_SELECTOR);
    await expect(splash).toBeVisible({ timeout: 4000 });

    const tag = await tagSplash(page);

    // Guard belum tertulis (splash masih tampil).
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBeNull();

    // Dorong satu entry histori via client-side Link supaya
    // page.goBack() memang bisa dilakukan tanpa reload dokumen.
    const detailLink = page
      .getByRole("link", { name: /detail\s*&\s*changelog/i })
      .first();
    await expect(detailLink).toBeVisible();
    await detailLink.click();
    await page.waitForURL(/\/download\/[^/]+$/, { timeout: 2000 });

    // Setelah client-side nav, splash harus tetap node yang sama.
    let state = await inspectSplash(page, tag);
    expect(state.present).toBe(true);
    expect(state.count).toBe(1);
    expect(state.sameTag).toBe(true);

    const expectedTdIsZero = mode === "reduce";
    if (expectedTdIsZero) {
      expect(state.td).toBe("0s");
    } else {
      expect(state.td).not.toBe("0s");
    }

    // BACK — popstate ke /download tanpa reload dokumen.
    // Deteksi reload via marker window: bila window global hilang,
    // berarti dokumen di-reload (tidak boleh terjadi).
    await page.evaluate(() => {
      (window as unknown as { __e2eMarker: number }).__e2eMarker = 1;
    });
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(/\/download$/, { timeout: 2000 });
    let marker = await page.evaluate(
      () => (window as unknown as { __e2eMarker?: number }).__e2eMarker ?? 0,
    );
    expect(marker).toBe(1); // dokumen sama, tanpa reload
    state = await inspectSplash(page, tag);
    expect(state.present).toBe(true);
    expect(state.sameTag).toBe(true); // TIDAK remount setelah back
    if (expectedTdIsZero) {
      expect(state.td).toBe("0s");
    } else {
      expect(state.td).not.toBe("0s");
    }

    // FORWARD — kembali ke /download/$variant, juga tanpa reload.
    // Hanya lakukan bila splash masih ada (untuk reduce yg hold-nya
    // pendek, splash bisa saja sudah hilang; skip forward-assert
    // konten splash bila demikian).
    await page.goForward({ waitUntil: "commit" });
    await page.waitForURL(/\/download\/[^/]+$/, { timeout: 2000 });
    marker = await page.evaluate(
      () => (window as unknown as { __e2eMarker?: number }).__e2eMarker ?? 0,
    );
    expect(marker).toBe(1); // masih dokumen yang sama

    state = await inspectSplash(page, tag);
    if (state.present) {
      // Selama splash masih terlihat: harus node yang sama.
      expect(state.sameTag).toBe(true);
      if (expectedTdIsZero) {
        expect(state.td).toBe("0s");
      } else {
        expect(state.td).not.toBe("0s");
      }
    }

    // BACK lagi untuk memastikan popstate berulang aman.
    await page.goBack({ waitUntil: "commit" });
    await page.waitForURL(/\/download$/, { timeout: 2000 });
    marker = await page.evaluate(
      () => (window as unknown as { __e2eMarker?: number }).__e2eMarker ?? 0,
    );
    expect(marker).toBe(1);

    // Splash pada akhirnya hilang; guard tertulis tepat SEKALI.
    await expect(page.locator(SPLASH_SELECTOR)).toBeHidden({ timeout: 3000 });
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    // Setelah splash hilang, node benar-benar tidak lagi ada di DOM.
    expect(await page.locator(SPLASH_SELECTOR).count()).toBe(0);

    await context.close();
  });
}
