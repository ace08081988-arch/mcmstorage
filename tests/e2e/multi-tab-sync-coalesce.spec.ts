import { test, expect, type Page } from "@playwright/test";

/**
 * E2E multi-tab: beberapa tab same-origin menulis SYNC_KEY hampir bersamaan
 * dan tiap tab memasang `createCoalescingScheduler` (logika yang sama persis
 * dipakai `useLiveSendLogStatus`). Tujuan: memverifikasi UI HANYA melakukan
 * satu apply per jendela coalescing, meski 5 tab menulis berbarengan.
 *
 * Strategi:
 *  1. Buka N halaman dalam satu BrowserContext (storage event lintas tab
 *     terpancar antar pages same-origin pada context yang sama).
 *  2. Tiap page memuat dev server, lalu `evaluate` dynamic-import
 *     `/src/lib/multi-tab-throttle.ts` dan memasang scheduler yang
 *     menghitung `applyCount` setiap kali `apply()` jatuh tempo.
 *  3. Setiap tab menulis localStorage["e2e-sync"] (memicu storage event di
 *     N-1 tab lain) sekaligus memanggil schedule() lokal.
 *  4. Tunggu jendela coalescing + buffer, lalu pastikan tiap tab tepat 1
 *     apply — bukan N apply.
 */

const TAB_COUNT = 5;
const WRITES_PER_TAB = 4;
// Pakai tuning "normal" agar test cepat & deterministik tanpa bergantung
// pada deteksi navigator runtime.
const TUNING = { throttle: 60, leading: 0, maxWait: 200 };

async function installProbe(page: Page, tuning: typeof TUNING) {
  await page.goto("/");
  await page.evaluate(async (t) => {
    // Import langsung dari Vite dev server — modul ESM project.
    const mod = await import("/src/lib/multi-tab-throttle.ts");
    const probe = {
      applyCount: 0,
      lastAppliedAt: 0 as number,
      events: 0,
    };
    (window as unknown as { __probe: typeof probe }).__probe = probe;
    const scheduler = mod.createCoalescingScheduler(
      () => {
        probe.applyCount += 1;
        probe.lastAppliedAt = Date.now();
      },
      t,
    );
    window.addEventListener("storage", (e) => {
      if (e.key === "e2e-sync") {
        probe.events += 1;
        scheduler.schedule();
      }
    });
    (window as unknown as { __schedule: () => void }).__schedule = () =>
      scheduler.schedule();
    // Mulai dengan storage bersih supaya tiap test berdiri sendiri.
    localStorage.removeItem("e2e-sync");
  }, tuning);
}

async function readProbe(page: Page) {
  return page.evaluate(() => {
    const p = (window as unknown as {
      __probe: { applyCount: number; events: number };
    }).__probe;
    return { applyCount: p.applyCount, events: p.events };
  });
}

test.describe("multi-tab SYNC_KEY coalescing", () => {
  test(`burst dari ${TAB_COUNT} tab terkompres jadi 1 apply per tab`, async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const pages: Page[] = [];
    for (let i = 0; i < TAB_COUNT; i++) {
      pages.push(await context.newPage());
    }
    for (const p of pages) await installProbe(p, TUNING);

    // Burst paralel: setiap tab menulis WRITES_PER_TAB kali ke SYNC_KEY,
    // dan setiap write juga memanggil schedule() lokal (mirroring tindakan
    // tab penulis yang men-dispatch SYNC_EVENT di tab-nya sendiri).
    await Promise.all(
      pages.map((p, idx) =>
        p.evaluate(
          ({ writes, idx }) => {
            const sched = (window as unknown as { __schedule: () => void })
              .__schedule;
            for (let i = 0; i < writes; i++) {
              localStorage.setItem(
                "e2e-sync",
                JSON.stringify({ tab: idx, i, t: Date.now() }),
              );
              sched();
            }
          },
          { writes: WRITES_PER_TAB, idx },
        ),
      ),
    );

    // Tunggu jendela coalescing tertutup + buffer (Playwright event loop).
    await pages[0].waitForTimeout(TUNING.throttle + 80);

    const results = await Promise.all(pages.map(readProbe));

    // Tiap tab harus melihat storage event dari (N-1) tab lain × WRITES_PER_TAB.
    // Total schedule() per tab = (N-1)*WRITES_PER_TAB storage event + WRITES_PER_TAB lokal.
    // Tapi applyCount HARUS tepat 1 (single update per coalescing window).
    for (const [i, r] of results.entries()) {
      expect.soft(r.applyCount, `tab ${i} applyCount`).toBe(1);
      expect.soft(r.events, `tab ${i} storage events`).toBeGreaterThanOrEqual(
        (TAB_COUNT - 1) * WRITES_PER_TAB - 2, // toleransi browser drop event
      );
    }
    expect(results.every((r) => r.applyCount === 1)).toBe(true);

    await context.close();
  });

  test("burst kedua setelah idle melewati maxWait → leading-edge, apply ke-2", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();
    await installProbe(a, TUNING);
    await installProbe(b, TUNING);

    // Burst 1
    await a.evaluate(() => {
      for (let i = 0; i < 5; i++) {
        localStorage.setItem("e2e-sync", String(i));
      }
    });
    await b.waitForTimeout(TUNING.throttle + 60);

    let r = await readProbe(b);
    expect(r.applyCount).toBe(1);

    // Idle > maxWait
    await b.waitForTimeout(TUNING.maxWait + 60);

    // Burst 2
    await a.evaluate(() => {
      for (let i = 0; i < 5; i++) {
        localStorage.setItem("e2e-sync", "burst2-" + i);
      }
    });
    await b.waitForTimeout(TUNING.throttle + 60);

    r = await readProbe(b);
    expect(r.applyCount).toBe(2);

    await context.close();
  });
});