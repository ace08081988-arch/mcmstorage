// @vitest-environment happy-dom
/**
 * Unit test untuk `applyChatModeBranding()`.
 *
 * Test ini memastikan setiap selector & atribut yang wajib berubah saat
 * mode chat aktif benar-benar ter-update — jadi kalau ada yang lupa
 * di-swap (mis. `<link rel="apple-touch-icon">`, atau salah satu
 * `<link rel="icon">`), test langsung merah.
 *
 * `applyChatModeBranding` menyimpan state `lastAppliedMode` di scope
 * modul, jadi kita `vi.resetModules()` di setiap test agar import
 * berikutnya mulai dari state bersih.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const BASE_HEAD = `
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width" />
  <meta name="theme-color" content="#0f172a" />
  <meta name="apple-mobile-web-app-title" content="MCM Storage" />
  <meta name="application-name" content="MCM Storage" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
  <link rel="shortcut icon" href="/favicon.ico" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
`;

function resetHead() {
  document.head.innerHTML = BASE_HEAD;
  document.title = "MCM Storage";
}

function stripQuery(href: string | null): string | null {
  if (!href) return href;
  return href.split("?")[0];
}

function loadModule() {
  // resetModules memastikan `lastAppliedMode` di-reset sebelum tiap test.
  return import("../chat-mode-branding");
}

beforeEach(() => {
  vi.resetModules();
  resetHead();
  try {
    window.localStorage.clear();
  } catch { /* ignore */ }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyChatModeBranding — mode chat aktif", () => {
  beforeEach(() => {
    window.localStorage.setItem("mcm.appMode", "chat");
  });

  it("mengubah document.title menjadi 'MCM Chat'", async () => {
    const { applyChatModeBranding } = await loadModule();
    applyChatModeBranding();
    expect(document.title).toBe("MCM Chat");
  });

  it("menyetel meta apple-mobile-web-app-title, application-name, theme-color", async () => {
    const { applyChatModeBranding } = await loadModule();
    applyChatModeBranding();
    const get = (name: string) =>
      document
        .querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
        ?.getAttribute("content");
    expect(get("apple-mobile-web-app-title")).toBe("MCM Chat");
    expect(get("application-name")).toBe("MCM Chat");
    expect(get("theme-color")).toBe("#064e3b");
  });

  it("membuat meta yang belum ada (bukan cuma update yang ada)", async () => {
    // Hapus meta theme-color untuk memastikan setMeta membuatnya.
    document.querySelector('meta[name="theme-color"]')?.remove();
    const { applyChatModeBranding } = await loadModule();
    applyChatModeBranding();
    expect(
      document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe("#064e3b");
  });

  it("mengganti <link rel=manifest> ke manifest-chat (dengan cache-buster)", async () => {
    const { applyChatModeBranding } = await loadModule();
    applyChatModeBranding();
    const manifests = document.querySelectorAll<HTMLLinkElement>(
      'link[rel="manifest"]',
    );
    // Harus tetap TEPAT SATU node manifest (bukan dobel).
    expect(manifests.length).toBe(1);
    const href = manifests[0].getAttribute("href")!;
    expect(stripQuery(href)).toBe("/manifest-chat.webmanifest");
    expect(href).toMatch(/\?v=chat-\d+/);
  });

  it("mengganti SEMUA <link rel=icon> ke /mcm-chat-icon.png", async () => {
    const { applyChatModeBranding } = await loadModule();
    applyChatModeBranding();
    const icons = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'),
    );
    expect(icons.length).toBeGreaterThanOrEqual(3);
    for (const el of icons) {
      expect(stripQuery(el.getAttribute("href"))).toBe("/mcm-chat-icon.png");
    }
  });

  it("mengganti shortcut icon dan apple-touch-icon", async () => {
    const { applyChatModeBranding } = await loadModule();
    applyChatModeBranding();
    const shortcut = document.querySelector<HTMLLinkElement>(
      'link[rel="shortcut icon"]',
    );
    const apple = document.querySelector<HTMLLinkElement>(
      'link[rel="apple-touch-icon"]',
    );
    expect(stripQuery(shortcut?.getAttribute("href") ?? null)).toBe(
      "/mcm-chat-icon.png",
    );
    expect(stripQuery(apple?.getAttribute("href") ?? null)).toBe(
      "/mcm-chat-icon.png",
    );
  });

  it("mempertahankan atribut lain pada <link rel=icon> (type/sizes tidak hilang)", async () => {
    const { applyChatModeBranding } = await loadModule();
    applyChatModeBranding();
    const sized = document.querySelector<HTMLLinkElement>(
      'link[rel="icon"][sizes="32x32"]',
    );
    expect(sized).not.toBeNull();
    expect(sized?.getAttribute("type")).toBe("image/png");
  });

  it("mengirim postMessage INVALIDATE_ASSETS ke service worker aktif", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { controller: { postMessage } },
    });
    const { applyChatModeBranding } = await loadModule();
    applyChatModeBranding();
    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = postMessage.mock.calls[0][0];
    expect(payload.type).toBe("INVALIDATE_ASSETS");
    expect(payload.paths).toEqual(
      expect.arrayContaining([
        "/manifest.webmanifest",
        "/manifest-chat.webmanifest",
        "/mcm-chat-icon.png",
        "/apple-touch-icon.png",
        "/favicon.ico",
      ]),
    );
  });

  it("tidak melakukan kerja ganda saat dipanggil dua kali untuk mode yang sama", async () => {
    const { applyChatModeBranding } = await loadModule();
    applyChatModeBranding();
    const firstManifest = document
      .querySelector<HTMLLinkElement>('link[rel="manifest"]')!
      .getAttribute("href");
    // Panggil lagi — karena mode tidak berubah, tidak boleh generate
    // node baru / cache-buster baru.
    applyChatModeBranding();
    const secondManifest = document
      .querySelector<HTMLLinkElement>('link[rel="manifest"]')!
      .getAttribute("href");
    expect(secondManifest).toBe(firstManifest);
    expect(
      document.querySelectorAll('link[rel="manifest"]').length,
    ).toBe(1);
  });
});

describe("applyChatModeBranding — pindah balik ke mode full", () => {
  it("me-restore title, theme-color, manifest, dan icon default", async () => {
    window.localStorage.setItem("mcm.appMode", "chat");
    const mod = await loadModule();
    mod.applyChatModeBranding();
    expect(document.title).toBe("MCM Chat");

    // Toggle balik ke full (nilai default saat key dihapus).
    window.localStorage.removeItem("mcm.appMode");
    mod.applyChatModeBranding();

    expect(document.title).toBe("MCM Storage");
    expect(
      document
        .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe("#0f172a");
    const manifest = document
      .querySelector<HTMLLinkElement>('link[rel="manifest"]')!
      .getAttribute("href")!;
    expect(stripQuery(manifest)).toBe("/manifest.webmanifest");
    const icons = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'),
    );
    for (const el of icons) {
      expect(stripQuery(el.getAttribute("href"))).toBe("/favicon.ico");
    }
    expect(
      stripQuery(
        document
          .querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')
          ?.getAttribute("href") ?? null,
      ),
    ).toBe("/apple-touch-icon.png");
  });
});

describe("applyChatModeBranding — SSR / no document", () => {
  it("aman dipanggil saat document tidak tersedia (no-throw)", async () => {
    const originalDocument = globalThis.document;
    // @ts-expect-error simulate SSR
    delete (globalThis as { document?: unknown }).document;
    try {
      const { applyChatModeBranding } = await loadModule();
      expect(() => applyChatModeBranding()).not.toThrow();
    } finally {
      (globalThis as { document: Document }).document = originalDocument;
    }
  });
});