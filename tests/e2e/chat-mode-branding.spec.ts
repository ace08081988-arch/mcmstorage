import { test, expect } from "@playwright/test";

/**
 * E2E: toggle Mode aplikasi ke "chat" harus segera mengubah branding
 * dokumen di runtime (tanpa reload):
 *   - document.title -> "MCM Chat"
 *   - <meta name="theme-color"> -> "#064e3b"
 *   - <link rel="icon">, <link rel="apple-touch-icon">, dan
 *     <link rel="shortcut icon"> -> "/mcm-chat-icon.png"
 *   - <link rel="manifest"> -> "/manifest-chat.webmanifest"
 *
 * Toggle di UI tinggal memanggil `setAppModeOverride("chat")` yang
 * menulis `localStorage["mcm.appMode"]` lalu memancarkan event
 * `mcm:app-mode-change`. Kita simulasikan dua langkah tersebut agar
 * test berjalan tanpa login.
 */

// Halaman publik apa saja yang me-mount __root sudah cukup — di sana
// listener `mcm:app-mode-change` terpasang dan branding diterapkan.
const URL = "/download";

test.describe("Mode aplikasi · branding runtime", () => {
  test("toggle ke chat mengubah title, theme-color, dan ikon", async ({
    page,
  }) => {
    await page.goto(URL);
    await page.waitForLoadState("domcontentloaded");

    // Baseline: mode default ("full") — pastikan branding chat BELUM
    // aktif supaya assertion setelah toggle bermakna.
    const before = await page.evaluate(() => ({
      title: document.title,
      themeColor:
        document
          .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
          ?.getAttribute("content") ?? null,
      icon:
        document
          .querySelector<HTMLLinkElement>('link[rel="icon"]')
          ?.getAttribute("href") ?? null,
      manifest:
        document
          .querySelector<HTMLLinkElement>('link[rel="manifest"]')
          ?.getAttribute("href") ?? null,
    }));
    expect(before.title).not.toBe("MCM Chat");
    expect(before.manifest ?? "").not.toContain("manifest-chat");

    // Toggle ke mode chat lewat API yang sama seperti tombol UI.
    await page.evaluate(() => {
      window.localStorage.setItem("mcm.appMode", "chat");
      window.dispatchEvent(new CustomEvent("mcm:app-mode-change"));
    });

    // Tunggu efek runtime terpasang (mikrotugas React + listener).
    await expect
      .poll(async () => page.evaluate(() => document.title), {
        timeout: 4000,
      })
      .toBe("MCM Chat");

    const after = await page.evaluate(() => {
      const iconHrefs = Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'),
      ).map((el) => el.getAttribute("href"));
      return {
        title: document.title,
        themeColor:
          document
            .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
            ?.getAttribute("content") ?? null,
        appTitle:
          document
            .querySelector<HTMLMetaElement>(
              'meta[name="apple-mobile-web-app-title"]',
            )
            ?.getAttribute("content") ?? null,
        applicationName:
          document
            .querySelector<HTMLMetaElement>('meta[name="application-name"]')
            ?.getAttribute("content") ?? null,
        iconHrefs,
        appleTouch:
          document
            .querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
            ?.getAttribute("href") ?? null,
        manifest:
          document
            .querySelector<HTMLLinkElement>('link[rel="manifest"]')
            ?.getAttribute("href") ?? null,
      };
    });

    expect(after.title).toBe("MCM Chat");
    expect(after.appTitle).toBe("MCM Chat");
    expect(after.applicationName).toBe("MCM Chat");
    expect(after.themeColor).toBe("#064e3b");
    // Setiap <link rel="icon"> harus di-swap — tidak boleh ada yang
    // masih menunjuk ikon MCM Storage.
    expect(after.iconHrefs.length).toBeGreaterThan(0);
    for (const href of after.iconHrefs) {
      expect(href).toBe("/mcm-chat-icon.png");
    }
    expect(after.appleTouch).toBe("/mcm-chat-icon.png");
    expect(after.manifest).toBe("/manifest-chat.webmanifest");

    // Cleanup — kembalikan ke mode default supaya test lain tidak
    // mewarisi state chat lewat storage state (kalau ada).
    await page.evaluate(() => {
      window.localStorage.removeItem("mcm.appMode");
      window.dispatchEvent(new CustomEvent("mcm:app-mode-change"));
    });
  });
});