import { test, expect } from "@playwright/test";

/**
 * E2E: saat mode aplikasi di-toggle ke "chat", service worker harus
 * meng-invalidate cache manifest & ikon sehingga aset yang tampil di
 * DOM benar-benar berubah TANPA reload manual.
 *
 * Alur test:
 *  1. Register stub service worker (dilayani via `page.route`) yang
 *     mencatat pesan `INVALIDATE_ASSETS` dan membalas `assets-invalidated`.
 *  2. Buka halaman publik, tunggu SW aktif + mengontrol page.
 *  3. Rekam href manifest/ikon sebelum toggle.
 *  4. Toggle ke mode chat (memanggil API yang sama seperti tombol UI).
 *  5. Verifikasi:
 *       - SW menerima `INVALIDATE_ASSETS` untuk path manifest+ikon.
 *       - href manifest/ikon di DOM sudah menunjuk ke aset MCM Chat
 *         (dengan cache-buster) — tanpa page reload.
 *       - Browser benar-benar melakukan request ulang ke
 *         `manifest-chat.webmanifest` sesudah invalidasi.
 */

const STUB_SW_PATH = "/__test-invalidate-sw.js";
// Stub SW: mencatat `INVALIDATE_ASSETS` di daftar internal + membalas
// pesan `assets-invalidated` sehingga test bisa poll via
// `navigator.serviceWorker.controller`.
const STUB_SW_SOURCE = `
self.__invalidated = [];
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'INVALIDATE_ASSETS' && Array.isArray(d.paths)) {
    self.__invalidated.push(...d.paths);
    // Broadcast supaya semua client (termasuk yang bukan event.source) tahu.
    self.clients.matchAll().then((cs) => {
      cs.forEach((c) => c.postMessage({ type: 'assets-invalidated', paths: d.paths }));
    });
  } else if (d.type === 'get-invalidated') {
    event.source && event.source.postMessage({
      type: 'invalidated-list', paths: self.__invalidated.slice(),
    });
  }
});
`;

test.describe("Mode chat · service worker cache invalidation", () => {
  test("SW menerima INVALIDATE_ASSETS dan manifest/ikon berubah tanpa reload", async ({
    page,
    context,
  }) => {
    // Sajikan stub SW script via route interceptor supaya kita tidak
    // perlu menaruh file test di /public.
    await context.route(`**${STUB_SW_PATH}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "Service-Worker-Allowed": "/" },
        body: STUB_SW_SOURCE,
      }),
    );

    await page.goto("/download");
    await page.waitForLoadState("domcontentloaded");

    // Bersihkan SW yang mungkin sudah terdaftar (sw-push.js dsb.) supaya
    // stub SW ini yang mengontrol page.
    await page.evaluate(async (stubPath) => {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      await navigator.serviceWorker.register(stubPath, { scope: "/" });
      // Tunggu sampai stub SW jadi controller aktif.
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => resolve(),
            { once: true },
          );
          // Fallback poll (Chromium kadang tidak memancarkan event kalau
          // controller sudah ter-set via skipWaiting+claim sebelum listener).
          const t = setInterval(() => {
            if (navigator.serviceWorker.controller) {
              clearInterval(t);
              resolve();
            }
          }, 50);
        });
      }
      // Siapkan collector pesan dari SW.
      (window as unknown as { __swMsgs: unknown[] }).__swMsgs = [];
      navigator.serviceWorker.addEventListener("message", (ev) => {
        (window as unknown as { __swMsgs: unknown[] }).__swMsgs.push(ev.data);
      });
    }, STUB_SW_PATH);

    // Baseline branding: mode default (bukan chat).
    const before = await page.evaluate(() => ({
      title: document.title,
      manifest:
        document
          .querySelector<HTMLLinkElement>('link[rel="manifest"]')
          ?.getAttribute("href") ?? null,
      icon:
        document
          .querySelector<HTMLLinkElement>('link[rel="icon"]')
          ?.getAttribute("href") ?? null,
    }));
    expect(before.title).not.toBe("MCM Chat");
    expect(before.manifest ?? "").not.toContain("manifest-chat");

    // Rekam fetch manifest baru sesudah invalidasi.
    const manifestRequests: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("manifest-chat.webmanifest")) manifestRequests.push(u);
    });

    // Toggle mode ke chat — sama seperti tombol UI di menu Pengaturan.
    await page.evaluate(() => {
      window.localStorage.setItem("mcm.appMode", "chat");
      window.dispatchEvent(new CustomEvent("mcm:app-mode-change"));
    });

    // 1) DOM branding harus berubah TANPA reload manual.
    await expect
      .poll(() => page.evaluate(() => document.title), { timeout: 4000 })
      .toBe("MCM Chat");

    const after = await page.evaluate(() => {
      const stripQuery = (href: string | null) =>
        href ? href.split("?")[0] : href;
      return {
        title: document.title,
        manifestPath: stripQuery(
          document
            .querySelector<HTMLLinkElement>('link[rel="manifest"]')
            ?.getAttribute("href") ?? null,
        ),
        manifestHref:
          document
            .querySelector<HTMLLinkElement>('link[rel="manifest"]')
            ?.getAttribute("href") ?? null,
        iconPath: stripQuery(
          document
            .querySelector<HTMLLinkElement>('link[rel="icon"]')
            ?.getAttribute("href") ?? null,
        ),
      };
    });
    expect(after.manifestPath).toBe("/manifest-chat.webmanifest");
    expect(after.iconPath).toBe("/mcm-chat-icon.png");
    // Cache-buster harus terpasang → memaksa browser fetch ulang.
    expect(after.manifestHref).toMatch(/[?&]v=chat-\d+/);

    // 2) SW harus menerima INVALIDATE_ASSETS dan meng-echo balasan.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { __swMsgs: Array<{ type: string }> })
                .__swMsgs.filter((m) => m && m.type === "assets-invalidated")
                .length,
          ),
        { timeout: 4000 },
      )
      .toBeGreaterThan(0);

    const invalidatedPaths = await page.evaluate(async () => {
      // Tanya stub SW daftar path yang tercatat di sisi worker.
      const ctrl = navigator.serviceWorker.controller!;
      const p = new Promise<string[]>((resolve) => {
        const handler = (ev: MessageEvent) => {
          const d = ev.data as { type?: string; paths?: string[] };
          if (d && d.type === "invalidated-list") {
            navigator.serviceWorker.removeEventListener("message", handler);
            resolve(d.paths ?? []);
          }
        };
        navigator.serviceWorker.addEventListener("message", handler);
      });
      ctrl.postMessage({ type: "get-invalidated" });
      return p;
    });
    // Manifest chat + ikon chat WAJIB masuk daftar invalidasi.
    expect(invalidatedPaths).toEqual(
      expect.arrayContaining([
        "/manifest-chat.webmanifest",
        "/mcm-chat-icon.png",
      ]),
    );

    // 3) Browser benar-benar memicu fetch ulang manifest yang baru
    //    (bukan hanya menyetel atribut). Ini adalah bukti bahwa
    //    invalidasi + node-replace berhasil mem-bypass cache.
    await expect.poll(() => manifestRequests.length, { timeout: 4000 })
      .toBeGreaterThan(0);
    // Setiap request harus menyertakan cache-buster.
    for (const url of manifestRequests) {
      expect(url).toMatch(/[?&]v=chat-\d+/);
    }

    // Cleanup — kembalikan ke mode default supaya test lain tidak
    // mewarisi state chat.
    await page.evaluate(async () => {
      window.localStorage.removeItem("mcm.appMode");
      window.dispatchEvent(new CustomEvent("mcm:app-mode-change"));
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    });
  });
});