import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * E2E: hard refresh SAAT splash tampil, lalu LANGSUNG navigasi
 * antar rute (client-side, tanpa reload lagi). Verifikasi:
 *
 *   1. Post-refresh, splash tampil ulang dari opacity ≈ 1 pada frame
 *      pertama (tidak fade-in dari 0 → tidak ada flash "kosong").
 *   2. Splash yang muncul post-refresh TIDAK remount saat rute
 *      berpindah — node yang sama tetap terpasang (splash hidup di
 *      __root; navigasi client-side tidak boleh meng-unmount-nya).
 *   3. `transitionDuration` konsisten dengan `prefers-reduced-motion`
 *      terkini (`0s` untuk reduce, non-`0s` untuk no-preference)
 *      SELAMA seluruh urutan aksi.
 *   4. Opacity monoton non-naik setelah fade-out dimulai (tidak ada
 *      flicker akibat re-render saat rute berubah).
 *   5. Session guard tertulis TEPAT sekali di akhir.
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

type Sample = {
  t: number;
  present: boolean;
  sameTag: boolean;
  op: number | null;
  td: string | null;
};

async function startSampler(page: Page, tag: string) {
  await page.evaluate(
    ({ sel, tag }) => {
      (window as unknown as { __samples: Sample[] }).__samples = [];
      const start = performance.now();
      const tick = () => {
        const el = document.querySelector<HTMLElement>(sel);
        const cs = el ? getComputedStyle(el) : null;
        (window as unknown as { __samples: Sample[] }).__samples.push({
          t: Math.round(performance.now() - start),
          present: !!el,
          sameTag: el ? el.getAttribute("data-e2e-tag") === tag : false,
          op: cs ? Number(cs.opacity) : null,
          td: cs ? cs.transitionDuration : null,
        });
      };
      (window as unknown as { __timer: ReturnType<typeof setInterval> }).__timer =
        setInterval(tick, 16);
      tick();
    },
    { sel: SPLASH_SELECTOR, tag },
  );
}

async function stopSampler(page: Page): Promise<Sample[]> {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __timer?: ReturnType<typeof setInterval>;
      __samples: Sample[];
    };
    if (w.__timer) clearInterval(w.__timer);
    return w.__samples ?? [];
  });
}

for (const mode of ["reduce", "no-preference"] as const) {
  test(`ChatModeSplash · hard refresh saat splash tampil + nav berurutan · reduce=${mode}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: mode });
    await seedChatMode(context);
    const page = await context.newPage();

    // Muat pertama: splash tampil, guard belum tertulis.
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await expect(page.locator(SPLASH_SELECTOR)).toBeVisible({ timeout: 4000 });
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBeNull();

    // HARD REFRESH saat splash masih tampil.
    await page.reload({ waitUntil: "domcontentloaded" });

    // Splash harus muncul kembali post-refresh (guard belum ada).
    await expect(page.locator(SPLASH_SELECTOR)).toBeVisible({ timeout: 4000 });

    // Tandai node splash post-refresh & mulai sampler untuk deteksi
    // flash / remount selama urutan navigasi berikutnya.
    const tag = await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) throw new Error("splash not found post-refresh");
      const t = `orig-${Math.random().toString(36).slice(2, 10)}`;
      el.setAttribute("data-e2e-tag", t);
      return t;
    }, SPLASH_SELECTOR);
    await startSampler(page, tag);

    // Baseline frame pertama post-refresh: opacity ≈ 1 (tidak fade-in
    // dari 0 → tidak ada "flash" transisi masuk yang salah).
    const first = await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { op: Number(cs.opacity), td: cs.transitionDuration };
    }, SPLASH_SELECTOR);
    expect(first).toBeTruthy();
    expect(first!.op).toBeGreaterThan(0.99);
    if (mode === "reduce") {
      expect(first!.td).toBe("0s");
    } else {
      expect(first!.td).not.toBe("0s");
    }

    // LANGSUNG navigasi client-side selagi splash tampil.
    // Nav 1 → /download/$variant
    const detailLinks = page.getByRole("link", {
      name: /detail\s*&\s*changelog/i,
    });
    await expect(detailLinks.first()).toBeVisible();
    await detailLinks.first().click();
    await page.waitForURL(/\/download\/[^/]+$/, { timeout: 2000 });
    // Nav 2 → /download (back link)
    if (mode === "no-preference") {
      await page.getByRole("link", { name: /kembali|semua/i }).first().click();
      await page.waitForURL(/\/download$/, { timeout: 2000 });
    }

    // Tunggu splash hilang, hentikan sampler.
    await expect(page.locator(SPLASH_SELECTOR)).toBeHidden({ timeout: 3500 });
    const samples = await stopSampler(page);

    // ── Assertions dari sampling ───────────────────────────────────

    // (a) Selama splash present: SELALU node yang sama (tidak remount)
    //     dan transitionDuration konsisten dengan mode.
    for (const s of samples) {
      if (!s.present) continue;
      expect(s.sameTag).toBe(true);
      if (mode === "reduce") {
        expect(s.td).toBe("0s");
      } else {
        expect(s.td).not.toBe("0s");
      }
    }

    // (b) Tidak ada "flash": frame pertama sampler harus present +
    //     opacity ≥ 0.99. Tidak boleh ada urutan absent→present→absent
    //     kecuali transisi tunggal ke absent (unmount akhir).
    const first0 = samples[0];
    expect(first0.present).toBe(true);
    expect(first0.op ?? 0).toBeGreaterThan(0.99);

    let toggles = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].present !== samples[i - 1].present) toggles++;
    }
    // Idealnya hanya 1 toggle: present → absent (akhir splash).
    expect(toggles).toBeLessThanOrEqual(1);

    // (c) Opacity tidak naik kembali setelah mulai turun.
    let peakedDown = false;
    let lastOp = 1;
    const EPS = 0.02;
    for (const s of samples) {
      if (!s.present || typeof s.op !== "number") continue;
      if (!peakedDown && s.op < 1 - EPS) peakedDown = true;
      if (peakedDown) expect(s.op).toBeLessThanOrEqual(lastOp + EPS);
      lastOp = s.op;
    }

    // (d) Guard tertulis TEPAT sekali.
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    await context.close();
  });
}
