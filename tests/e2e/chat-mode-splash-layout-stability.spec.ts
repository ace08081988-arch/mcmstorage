import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * E2E: memverifikasi TIDAK ADA layout shift atau perubahan ukuran
 * yang tidak wajar selama transisi ChatModeSplash — baik pada mode
 * `prefers-reduced-motion: reduce` maupun `no-preference`.
 *
 * Kita ukur dua sinyal independen:
 *   1. Cumulative Layout Shift (CLS) via PerformanceObserver
 *      (`layout-shift` entries dengan `hadRecentInput=false`).
 *   2. Sampling bounding box splash + <main> setiap ~30ms untuk
 *      memastikan lebar/tinggi konten di belakang splash tetap stabil
 *      dan bounding box splash sendiri tidak bergeser/ berubah ukuran
 *      selama masih terlihat (opacity fade diperbolehkan; layout tidak).
 */

const URL = "/download";
const SPLASH_SELECTOR = '[aria-label="Memuat MCM Chat"]';

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

async function installObservers(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    (window as unknown as { __shifts: unknown[] }).__shifts = [];
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEntry[]) {
          // @ts-expect-error layout-shift entry shape
          if (entry.hadRecentInput) continue;
          // @ts-expect-error layout-shift entry shape
          const value = entry.value as number;
          (window as unknown as { __cls: number }).__cls += value;
          (window as unknown as { __shifts: unknown[] }).__shifts.push({
            value,
            startTime: entry.startTime,
          });
        }
      });
      obs.observe({ type: "layout-shift", buffered: true });
    } catch {
      /* layout-shift tidak tersedia — CLS akan 0 */
    }
  });
}

type Sample = {
  t: number;
  splash: { x: number; y: number; w: number; h: number; opacity: number } | null;
  main: { w: number; h: number } | null;
};

async function sampleFrames(page: Page, durationMs: number): Promise<Sample[]> {
  return await page.evaluate(async (dur) => {
    const out: Sample[] = [];
    const start = performance.now();
    const readSplash = () => {
      const el = document.querySelector<HTMLElement>(
        '[aria-label="Memuat MCM Chat"]',
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        opacity: Number(cs.opacity),
      };
    };
    const readMain = () => {
      const el =
        document.querySelector<HTMLElement>("main") ??
        document.body;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    while (performance.now() - start < dur) {
      out.push({
        t: Math.round(performance.now() - start),
        splash: readSplash(),
        main: readMain(),
      });
      await new Promise((r) => setTimeout(r, 30));
    }
    return out;
  }, durationMs);
}

function assertStableSplashBox(samples: Sample[]) {
  const visible = samples.filter((s) => s.splash && s.splash.opacity > 0.01);
  if (visible.length < 2) return; // nothing to compare
  const first = visible[0].splash!;
  for (const s of visible) {
    const b = s.splash!;
    // Bounding box tidak boleh bergeser/berubah ukuran > 1px
    // selama splash terlihat. Opacity fade OK.
    expect(Math.abs(b.x - first.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y - first.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.w - first.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.h - first.h)).toBeLessThanOrEqual(1);
  }
}

function assertStableMainBox(samples: Sample[]) {
  const mains = samples.map((s) => s.main).filter(Boolean) as Array<
    NonNullable<Sample["main"]>
  >;
  if (mains.length < 2) return;
  const w0 = mains[0].w;
  const h0 = mains[0].h;
  for (const m of mains) {
    // Konten di belakang splash tidak boleh reflow karena
    // munculnya/hilangnya splash (splash overlay = fixed).
    // Toleransi 2px untuk scrollbar rounding.
    expect(Math.abs(m.w - w0)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.h - h0)).toBeLessThanOrEqual(2);
  }
}

for (const mode of ["reduce", "no-preference"] as const) {
  test(`ChatModeSplash · zero layout shift · reduced-motion=${mode}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: mode });
    await seedChatMode(context);
    const page = await context.newPage();
    await installObservers(page);

    await page.goto(URL, { waitUntil: "domcontentloaded" });

    const splash = page.locator(SPLASH_SELECTOR);
    await expect(splash).toBeVisible({ timeout: 4000 });

    // Reduce ≈ 400ms hold; non-reduce ≈ 1000ms hold + 500ms fade.
    // Ambil sampling cukup panjang untuk mencakup hilangnya splash.
    const durationMs = mode === "reduce" ? 1200 : 2200;
    const samples = await sampleFrames(page, durationMs);

    // 1. CLS harus mendekati nol selama transisi splash.
    const cls = await page.evaluate(
      () => (window as unknown as { __cls: number }).__cls ?? 0,
    );
    // Ambang ketat: browser bisa mencatat sub-pixel drift kecil.
    expect(cls).toBeLessThan(0.01);

    // 2. Bounding box splash stabil sementara terlihat.
    assertStableSplashBox(samples);

    // 3. Konten di belakang tidak reflow karena splash muncul/hilang.
    assertStableMainBox(samples);

    // 4. Splash benar-benar hilang di akhir window.
    await expect(splash).toBeHidden({ timeout: 500 });

    await context.close();
  });
}
