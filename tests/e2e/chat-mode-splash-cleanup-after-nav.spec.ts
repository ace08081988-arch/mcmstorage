import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * E2E: memverifikasi bahwa setelah ChatModeSplash selesai + navigasi
 * client-side, TIDAK ada sisa class/inline-style/animasi dari splash
 * yang menempel di DOM — di kedua mode `prefers-reduced-motion`.
 *
 * Yang diperiksa (post-splash + post-nav):
 *   1. Node splash `[aria-label="Memuat MCM Chat"]` benar-benar 0.
 *   2. Tidak ada `<style>` yang masih membawa keyframes splash
 *      (`mcm-chat-splash-pop` / `mcm-chat-splash-slide`) di document.
 *   3. Tidak ada elemen (langsung anak <body>) yang mewarisi opacity
 *      < 1 atau `transition-opacity` sisa dari splash.
 *   4. `document.body` bersih dari inline style/kelas terkait splash
 *      (mis. `pointer-events-none`, `overflow-hidden`) yang tidak
 *      dipasang aplikasi secara permanen.
 *   5. Tidak ada CSSAnimation aktif yang menggunakan nama keyframes
 *      splash (`getAnimations()` pada seluruh subtree).
 */

const URL = "/download";
const SPLASH_SELECTOR = '[aria-label="Memuat MCM Chat"]';
const SPLASH_KEYFRAMES = ["mcm-chat-splash-pop", "mcm-chat-splash-slide"] as const;

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

async function collectResidue(page: Page) {
  return await page.evaluate((kf) => {
    // 1. Jumlah node splash yang tersisa.
    const splashCount = document.querySelectorAll(
      '[aria-label="Memuat MCM Chat"]',
    ).length;

    // 2. Cek <style> apapun yang masih memuat keyframes splash.
    const styleTags = Array.from(document.querySelectorAll("style"));
    const leakedStyles = styleTags
      .map((s) => s.textContent ?? "")
      .filter((t) => kf.some((name) => t.includes(name)));

    // 3. Cek CSSAnimation aktif pakai nama keyframes splash.
    let activeAnims: string[] = [];
    try {
      const all = document.getAnimations();
      for (const a of all) {
        const name =
          (a as unknown as { animationName?: string }).animationName ??
          (typeof (a as unknown as { id?: string }).id === "string"
            ? (a as unknown as { id: string }).id
            : "");
        if (kf.some((n) => (name ?? "").includes(n))) {
          activeAnims.push(name ?? "");
        }
      }
    } catch {
      /* getAnimations tidak tersedia — abaikan */
    }

    // 4. Elemen langsung <body> dgn opacity < 1 atau transisi opacity
    //    yang mencurigakan (kandidat residu splash).
    const suspiciousChildren: Array<{
      tag: string;
      op: number;
      td: string;
      cls: string;
    }> = [];
    for (const el of Array.from(document.body.children) as HTMLElement[]) {
      // Portal splash lah yg biasanya jadi direct child body. Skip
      // elemen script/style/link default.
      if (["SCRIPT", "STYLE", "LINK"].includes(el.tagName)) continue;
      const cs = getComputedStyle(el);
      const op = Number(cs.opacity);
      const td = cs.transitionDuration;
      // Aplikasi shell normal: opacity 1, transitionDuration bisa 0s.
      if (op < 0.99 || (td !== "0s" && cs.transitionProperty.includes("opacity"))) {
        suspiciousChildren.push({
          tag: el.tagName,
          op,
          td,
          cls: el.className || "",
        });
      }
    }

    // 5. Inline style/class body langsung.
    const bodyClass = document.body.className;
    const bodyInline = document.body.getAttribute("style") ?? "";

    return {
      splashCount,
      leakedStyles,
      activeAnims,
      suspiciousChildren,
      bodyClass,
      bodyInline,
    };
  }, SPLASH_KEYFRAMES as unknown as string[]);
}

for (const mode of ["reduce", "no-preference"] as const) {
  test(`ChatModeSplash · cleanup class/inline style setelah nav · reduce=${mode}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: mode });
    await seedChatMode(context);
    const page = await context.newPage();

    await page.goto(URL, { waitUntil: "domcontentloaded" });

    const splash = page.locator(SPLASH_SELECTOR);
    await expect(splash).toBeVisible({ timeout: 4000 });

    // Navigasi client-side ringan sementara splash tampil.
    const detailLink = page
      .getByRole("link", { name: /detail\s*&\s*changelog/i })
      .first();
    await expect(detailLink).toBeVisible();
    await detailLink.click();
    await page.waitForURL(/\/download\/[^/]+$/, { timeout: 2000 });

    // Tunggu splash benar-benar hilang.
    await expect(page.locator(SPLASH_SELECTOR)).toBeHidden({ timeout: 3500 });
    // Lakukan satu nav lagi post-splash untuk memastikan tidak ada
    // "residual state" yang muncul kembali karena route berubah.
    const backLink = page.getByRole("link", { name: /kembali|semua/i }).first();
    await backLink.click();
    await page.waitForURL(/\/download$/, { timeout: 2000 });

    // Beri beberapa frame agar React commit unmount portal.
    await page.waitForTimeout(120);

    const residue = await collectResidue(page);

    // 1. Tidak ada node splash tersisa.
    expect(residue.splashCount).toBe(0);
    // 2. Tidak ada <style> yang masih memuat keyframes splash.
    expect(residue.leakedStyles).toEqual([]);
    // 3. Tidak ada CSSAnimation aktif memakai nama keyframes splash.
    expect(residue.activeAnims).toEqual([]);
    // 4. Tidak ada anak <body> dengan opacity < 1 atau transisi
    //    opacity mencurigakan (residu fade).
    expect(residue.suspiciousChildren).toEqual([]);
    // 5. <body> tidak diberi kelas/inline style pointer-events-none
    //    atau opacity residu.
    expect(residue.bodyClass).not.toMatch(/pointer-events-none/);
    expect(residue.bodyInline).not.toMatch(/opacity\s*:/i);
    expect(residue.bodyInline).not.toMatch(/pointer-events\s*:\s*none/i);

    await context.close();
  });
}
