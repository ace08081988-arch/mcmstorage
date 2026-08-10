// @vitest-environment happy-dom
/**
 * B1: mekanisme khusus web tidak boleh berjalan di dalam APK.
 * native=true → tidak register/update SW, tidak fetch /api/version,
 * tidak requestFullscreen. native push & deep-link TIDAK diguard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

function setNative(v: boolean) {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => v,
    getPlatform: () => (v ? "android" : "web"),
  };
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  vi.restoreAllMocks();
});

describe("guard native pada mekanisme web", () => {
  it("native=true: installSwAutoUpdate tidak menyentuh serviceWorker", async () => {
    setNative(true);
    const register = vi.fn();
    const getRegistrations = vi.fn().mockResolvedValue([]);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register, getRegistrations, addEventListener: vi.fn(), controller: null },
    });
    const { installSwAutoUpdate } = await import("./sw-auto-update");
    installSwAutoUpdate();
    await Promise.resolve();
    expect(register).not.toHaveBeenCalled();
    expect(getRegistrations).not.toHaveBeenCalled();
  });

  it("native=true: installBuildCacheBuster tidak fetch /api/version", async () => {
    setNative(true);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
    const { installBuildCacheBuster } = await import("./build-cache-buster");
    installBuildCacheBuster();
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("native=true: startAutoFullscreenOnInstalled tidak memasang listener & tidak requestFullscreen", async () => {
    setNative(true);
    const addSpy = vi.spyOn(window, "addEventListener");
    const docAddSpy = vi.spyOn(document, "addEventListener");
    const reqFs = vi.fn();
    (document.documentElement as unknown as { requestFullscreen: unknown }).requestFullscreen = reqFs;
    const { startAutoFullscreenOnInstalled } = await import("./fullscreen-mode");
    const stop = startAutoFullscreenOnInstalled();
    const pointer = addSpy.mock.calls.filter(([e]) => e === "pointerdown" || e === "keydown");
    const docPointer = docAddSpy.mock.calls.filter(([e]) => e === "pointerdown" || e === "keydown");
    expect([...pointer, ...docPointer]).toHaveLength(0);
    expect(reqFs).not.toHaveBeenCalled();
    expect(typeof stop).toBe("function");
    stop();
  });

  it("native=false: installSwAutoUpdate tetap register SW (perilaku PWA lama)", async () => {
    setNative(false);
    const register = vi.fn().mockResolvedValue({
      addEventListener: vi.fn(), update: vi.fn(), installing: null, waiting: null, active: null,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register, getRegistrations: vi.fn().mockResolvedValue([]), addEventListener: vi.fn(), controller: null },
    });
    const { installSwAutoUpdate } = await import("./sw-auto-update");
    installSwAutoUpdate();
    await Promise.resolve();
    expect(register).toHaveBeenCalled();
  });

  it("startPushKeepAlive & auto-fullscreen diguard isNativeApp()", () => {
    const push = readFileSync("src/lib/push-client.ts", "utf8");
    expect(push).toMatch(/startPushKeepAlive[\s\S]{0,200}isNativeApp\(\)/);
    const fs = readFileSync("src/lib/fullscreen-mode.ts", "utf8");
    expect(fs).toMatch(/startAutoFullscreenOnInstalled[\s\S]{0,300}isNativeApp\(\)/);
  });

  it("daftar chat mengirim rowVersion berisi selecting + selectedIds", () => {
    const src = readFileSync("src/routes/_authenticated.chat.index.tsx", "utf8");
    expect(src).toContain("rowVersion=");
    const line = src.split("\n").find((l) => l.includes("rowVersion=")) ?? "";
    expect(line).toContain("selecting");
    expect(line).toContain("selectedIds");
  });

  it("native push & deep-link listener TIDAK diguard oleh isNativeApp()", () => {
    const push = readFileSync("src/lib/native-push.ts", "utf8");
    const deeplink = readFileSync("src/lib/native-deeplink.ts", "utf8");
    const perm = readFileSync("src/lib/permission-bootstrap.ts", "utf8");
    expect(push).not.toContain("isNativeApp");
    expect(deeplink).not.toContain("isNativeApp");
    expect(perm).not.toContain("isNativeApp");
  });
});

describe("smoke: caller kamera/galeri/share memakai app-lock", () => {
  const cases: Array<[string, string]> = [
    ["src/routes/t.$token.tsx", "beginNativePicker"],
    ["src/lib/chat-attachments.ts", "armFilePickerLock"],
    ["src/routes/_authenticated.ecer.tsx", "openFilePickerWithLock"],
    ["src/routes/_authenticated.request.tsx", "openFilePickerWithLock"],
    ["src/components/ProductEditDrawer.tsx", "armFilePickerLock"],
    ["src/lib/share-wa.ts", "armExternalShareLock"],
  ];
  it.each(cases)("%s memakai %s", (file, symbol) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain(symbol);
    expect(src).toContain("app-lock");
  });

  it("ecer/request tidak lagi memanggil ref.click() langsung untuk kamera/galeri", () => {
    for (const f of ["src/routes/_authenticated.ecer.tsx", "src/routes/_authenticated.request.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toContain("cameraRef.current?.click()");
      expect(src).not.toContain("galleryRef.current?.click()");
    }
  });
});
