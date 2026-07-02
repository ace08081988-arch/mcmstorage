import { test, expect } from "@playwright/test";

/**
 * E2E: rapid-toggle `prefers-reduced-motion` saat splash sedang tampil.
 *
 * Kontrak yang diverifikasi:
 *  - Timeline JS (hold + fade) yang ditentukan di mount tidak
 *    tumpang tindih walau media query di-flip berkali-kali cepat.
 *  - Tidak ada state animasi yang "rusak": splash tidak flicker
 *    (opacity-100 ↔ opacity-0 lebih dari sekali), tidak stuck di
 *    layar, dan tidak memicu fase fade lebih awal / lebih akhir
 *    dari timeline mount awal.
 *  - Session guard (`mcm.chat.splashShown`) tetap tertulis persis
 *    sekali setelah splash selesai.
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

test.describe("ChatModeSplash · rapid toggle prefers-reduced-motion", () => {
  test("toggle cepat 10x saat splash tampil (start=normal) — timeline penuh utuh, tanpa flicker", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "no-preference" });
    await seedChatMode(context);
    const page = await context.newPage();

    // Sadap className splash untuk mendeteksi flicker: berapa kali
    // token `opacity-0` masuk/keluar. Diharapkan tepat SATU transisi
    // opacity-100 → opacity-0 sepanjang timeline.
    await page.addInitScript(() => {
      (window as unknown as { __opacityLog: string[] }).__opacityLog = [];
      const obs = new MutationObserver(() => {
        const el = document.querySelector<HTMLElement>(
          '[aria-label="Memuat MCM Chat"]',
        );
        if (!el) return;
        const log = (window as unknown as { __opacityLog: string[] })
          .__opacityLog;
        const cur = el.className.includes("opacity-0") ? "fade" : "solid";
        if (log[log.length - 1] !== cur) log.push(cur);
      });
      obs.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    });

    await page.goto(URL);
    await page.waitForLoadState("domcontentloaded");

    const splash = page.getByRole("status", { name: SPLASH_NAME });
    await expect(splash).toBeVisible({ timeout: 4000 });

    // 10 toggle cepat dalam ~500ms (masih di dalam hold 1000ms).
    const modes: Array<"reduce" | "no-preference"> = [
      "reduce",
      "no-preference",
      "reduce",
      "no-preference",
      "reduce",
      "no-preference",
      "reduce",
      "no-preference",
      "reduce",
      "no-preference",
    ];
    for (const m of modes) {
      await page.emulateMedia({ reducedMotion: m });
      await page.waitForTimeout(50);
    }

    // Splash MASIH terlihat setelah toggle-storm (~500ms) — timeline
    // JS penuh belum masuk fase fade.
    await expect(splash).toBeVisible();
    const midClass = await splash.getAttribute("class");
    expect(midClass ?? "").not.toContain("opacity-0");

    // Tunggu sampai splash benar-benar hilang.
    await expect(splash).toBeHidden({ timeout: 4000 });

    // Log opacity: harus mulai "solid" lalu berpindah ke "fade"
    // paling banyak sekali. Tidak boleh solid→fade→solid (flicker).
    const log = await page.evaluate(
      () => (window as unknown as { __opacityLog: string[] }).__opacityLog,
    );
    // "solid" pertama dicatat saat MutationObserver melihat splash.
    expect(log[0]).toBe("solid");
    // Setelah itu paling banyak satu transisi ke "fade".
    const transitions = log.slice(1);
    expect(transitions.length).toBeLessThanOrEqual(1);
    if (transitions.length === 1) expect(transitions[0]).toBe("fade");

    // Session guard tertulis (tepat sekali).
    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    await context.close();
  });

  test("toggle cepat 10x saat splash tampil (start=reduce) — hilang cepat tanpa fade yang salah", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    await seedChatMode(context);
    const page = await context.newPage();

    await page.addInitScript(() => {
      (window as unknown as { __opacityLog: string[] }).__opacityLog = [];
      const obs = new MutationObserver(() => {
        const el = document.querySelector<HTMLElement>(
          '[aria-label="Memuat MCM Chat"]',
        );
        if (!el) return;
        const log = (window as unknown as { __opacityLog: string[] })
          .__opacityLog;
        const cur = el.className.includes("opacity-0") ? "fade" : "solid";
        if (log[log.length - 1] !== cur) log.push(cur);
      });
      obs.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    });

    await page.goto(URL);
    await page.waitForLoadState("domcontentloaded");

    const splash = page.getByRole("status", { name: SPLASH_NAME });
    await expect(splash).toBeVisible({ timeout: 4000 });

    // Flip cepat — total ~150ms, masih di dalam hold reduce 400ms.
    for (let i = 0; i < 10; i++) {
      await page.emulateMedia({
        reducedMotion: i % 2 === 0 ? "no-preference" : "reduce",
      });
      await page.waitForTimeout(15);
    }

    // Splash harus hilang cepat (≤3s) sesuai timeline reduce yang
    // dijadwalkan di mount — bukan bergeser ke timeline penuh.
    await expect(splash).toBeHidden({ timeout: 3000 });

    // Log opacity: karena reduce, fade JS = 0ms → praktis tidak ada
    // transisi ke "fade" yang terekam, atau paling banyak satu
    // frame. Tidak boleh ada pola solid→fade→solid.
    const log = await page.evaluate(
      () => (window as unknown as { __opacityLog: string[] }).__opacityLog,
    );
    // Sekali "solid" di awal, lalu paling banyak satu transisi.
    const solids = log.filter((v) => v === "solid").length;
    expect(solids).toBeLessThanOrEqual(1);

    expect(
      await page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY),
    ).toBe("1");

    await context.close();
  });
});
