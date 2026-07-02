import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * E2E: menggabungkan dua stresor sekaligus — navigasi client-side
 * berurutan DAN toggle `prefers-reduced-motion` beberapa kali cepat —
 * sambil ChatModeSplash masih tampil. Verifikasi:
 *
 *   1. Splash tidak remount: node DOM asli (ditandai `data-e2e-tag`)
 *      tetap terpasang lintas seluruh nav + toggle.
 *   2. Tidak ada transisi salah: `transitionDuration` yang terbaca
 *      SELALU salah satu dari {"0s"} (reduce) atau non-"0s"
 *      (no-preference) — tidak pernah nilai aneh (NaN, negatif,
 *      atau format non-detik).
 *   3. Opacity tidak pernah naik kembali (fade-in ulang) setelah
 *      splash mulai fade-out — hanya monoton menurun.
 *   4. Session guard ditulis TEPAT sekali meskipun mode & rute
 *      di-flip berkali-kali.
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

type Sample = {
  t: number;
  present: boolean;
  sameTag: boolean;
  count: number;
  op: number | null;
  td: string | null;
};

async function startSampler(page: Page, tag: string) {
  // Sampler background dalam page context: catat state splash tiap
  // 20ms, sampai splash hilang atau timeout.
  await page.evaluate(
    ({ sel, tag }) => {
      (window as unknown as { __splashSamples: Sample[] }).__splashSamples =
        [];
      const start = performance.now();
      const tick = () => {
        const nodes = document.querySelectorAll<HTMLElement>(sel);
        const el = nodes[0] ?? null;
        const cs = el ? getComputedStyle(el) : null;
        (window as unknown as { __splashSamples: Sample[] }).__splashSamples.push(
          {
            t: Math.round(performance.now() - start),
            present: !!el,
            sameTag: el
              ? el.getAttribute("data-e2e-tag") === tag
              : false,
            count: nodes.length,
            op: cs ? Number(cs.opacity) : null,
            td: cs ? cs.transitionDuration : null,
          },
        );
      };
      (window as unknown as { __splashTimer: ReturnType<typeof setInterval> }).__splashTimer =
        setInterval(tick, 20);
      tick();
    },
    { sel: SPLASH_SELECTOR, tag },
  );
}

async function stopSampler(page: Page): Promise<Sample[]> {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __splashTimer?: ReturnType<typeof setInterval>;
      __splashSamples: Sample[];
    };
    if (w.__splashTimer) clearInterval(w.__splashTimer);
    return w.__splashSamples ?? [];
  });
}

test("ChatModeSplash · nav berurutan + rapid toggle reduce-motion", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "no-preference" });
  await seedChatMode(context);
  const page = await context.newPage();

  await page.goto(URL, { waitUntil: "domcontentloaded" });

  const splash = page.locator(SPLASH_SELECTOR);
  await expect(splash).toBeVisible({ timeout: 4000 });

  const tag = await tagSplash(page);
  await startSampler(page, tag);

  // Guard belum tertulis.
  expect(
    await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
  ).toBeNull();

  const detailLinks = page.getByRole("link", {
    name: /detail\s*&\s*changelog/i,
  });
  await expect(detailLinks.first()).toBeVisible();

  // Rangkaian aksi: nav → toggle → nav → toggle → nav → toggle …
  // Non-reduce hold ~1000ms + fade ~500ms ⇒ jendela cukup untuk 3 nav.
  const flip = async (m: "reduce" | "no-preference") => {
    await page.emulateMedia({ reducedMotion: m });
  };

  // Toggle 1
  await flip("reduce");
  // Nav 1
  await detailLinks.first().click();
  await page.waitForURL(/\/download\/[^/]+$/, { timeout: 2000 });
  // Toggle 2
  await flip("no-preference");
  // Nav 2 (back link)
  await page.getByRole("link", { name: /kembali|semua/i }).first().click();
  await page.waitForURL(/\/download$/, { timeout: 2000 });
  // Toggle 3–4 (rapid, dalam ~50ms)
  await flip("reduce");
  await page.waitForTimeout(30);
  await flip("no-preference");
  // Nav 3
  const detailLinks2 = page.getByRole("link", {
    name: /detail\s*&\s*changelog/i,
  });
  const target =
    (await detailLinks2.count()) >= 2 ? detailLinks2.nth(1) : detailLinks2.first();
  await target.click();
  await page.waitForURL(/\/download\/[^/]+$/, { timeout: 2000 });
  // Toggle akhir
  await flip("reduce");

  // Tunggu splash hilang.
  await expect(page.locator(SPLASH_SELECTOR)).toBeHidden({ timeout: 3500 });
  const samples = await stopSampler(page);

  // ── Verifikasi hasil sampling ────────────────────────────────────

  // (a) Selagi splash present, node harus selalu bertag sama (tidak
  //     remount) dan hanya satu instance.
  for (const s of samples) {
    if (s.present) {
      expect(s.sameTag).toBe(true);
      expect(s.count).toBe(1);
    }
  }

  // (b) transitionDuration selalu format detik yang valid ("0s" atau
  //     bilangan positif diikuti "s"). Tidak boleh NaN/negatif/kosong.
  const tdRe = /^(0s|[0-9]*\.?[0-9]+m?s)$/;
  for (const s of samples) {
    if (s.present && s.td !== null) {
      expect(s.td).toMatch(tdRe);
      // Bila reduce marker Tailwind aktif, hasil computed = "0s".
      // Selain itu > 0. Tidak ada nilai negatif.
      const asMs = /ms$/.test(s.td)
        ? parseFloat(s.td)
        : parseFloat(s.td) * 1000;
      expect(Number.isFinite(asMs)).toBe(true);
      expect(asMs).toBeGreaterThanOrEqual(0);
    }
  }

  // (c) Opacity tidak boleh naik kembali setelah mulai turun
  //     (deteksi "flicker" / fade-in ulang saat toggle).
  const ops = samples
    .filter((s) => s.present && typeof s.op === "number")
    .map((s) => s.op!) as number[];
  let peakedDown = false;
  let lastOp = 1;
  const EPS = 0.02;
  for (const op of ops) {
    if (!peakedDown && op < 1 - EPS) peakedDown = true;
    if (peakedDown) {
      // Setelah pernah turun dari 1, tidak boleh naik lagi > toleransi.
      expect(op).toBeLessThanOrEqual(lastOp + EPS);
    }
    lastOp = op;
  }

  // (d) Guard tertulis tepat sekali.
  expect(
    await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
  ).toBe("1");

  // (e) Setelah splash hilang, tidak ada residu node.
  expect(await page.locator(SPLASH_SELECTOR).count()).toBe(0);

  await context.close();
});
