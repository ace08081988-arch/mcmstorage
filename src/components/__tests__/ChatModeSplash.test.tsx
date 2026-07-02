// @vitest-environment happy-dom
/**
 * Unit test untuk `ChatModeSplash`.
 *
 * Yang diverifikasi:
 *  1. Saat `prefers-reduced-motion: reduce` aktif, splash TIDAK
 *     melakukan transisi fade — `fade` scheduler dijadwalkan pada
 *     durasi 0ms sehingga `visible` langsung menjadi `false` tepat
 *     setelah hold selesai (tanpa jeda animasi). Kita juga memastikan
 *     className mengandung `motion-reduce:transition-none` untuk
 *     kasus di mana keyframes CSS terpakai.
 *  2. Splash konsisten saat "pindah halaman": remount komponen di
 *     session yang sama TIDAK menampilkan splash lagi (dilindungi
 *     `sessionStorage` + flag modul).
 *
 * Catatan: `ChatModeSplash` men-schedule state via `setTimeout` &
 * merender via `createPortal(document.body)`, jadi kita pakai
 * `vi.useFakeTimers()` dan periksa DOM `document.body` (bukan wrapper
 * container React).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// React 19: perlu flag ini di test env agar `act()` tidak memancarkan
// warning "The current testing environment is not configured...".
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// Kontrol return value `isChatOnly()` per-test.
let chatOnly = true;
vi.mock("@/lib/app-mode", () => ({
  isChatOnly: () => chatOnly,
}));

// Fabrikasi `window.matchMedia` yang bisa diarahkan per-test untuk
// mensimulasikan `prefers-reduced-motion: reduce`.
let reduceMotion = false;
function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduceMotion && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

async function loadComponent() {
  vi.resetModules();
  const mod = await import("../ChatModeSplash");
  return mod.ChatModeSplash;
}

function mount(Component: React.ComponentType): { root: Root; host: HTMLDivElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<Component />);
  });
  return { root, host };
}

function splashNode(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[aria-label="Memuat MCM Chat"]');
}

beforeEach(() => {
  vi.useFakeTimers();
  chatOnly = true;
  reduceMotion = false;
  installMatchMedia();
  window.sessionStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChatModeSplash · prefers-reduced-motion", () => {
  it("tidak melakukan transisi fade dan hilang tanpa jeda animasi", async () => {
    reduceMotion = true;
    const Splash = await loadComponent();
    const { root } = mount(Splash);

    // Setelah mount + useEffect, splash tampak.
    act(() => {
      // Biarkan efek berjalan.
    });
    const el = splashNode();
    expect(el).not.toBeNull();
    // Marker className harus tetap ada supaya CSS `motion-reduce`
    // tidak menganimasikan opacity meski komponen dipakai di
    // konteks lain.
    expect(el!.className).toContain("motion-reduce:transition-none");

    // Reduce-motion: hold=400ms, fade=0ms → total sampai unmount = 400ms.
    // Setelah 399ms splash masih ada, setelah 400ms sudah hilang.
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(splashNode()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    // Kedua timer (fade + unmount) jatuh di tick yang sama karena
    // fade=0ms → splash langsung tidak dirender lagi tanpa jeda fade.
    expect(splashNode()).toBeNull();

    // Session key harus tercatat supaya remount berikutnya tidak
    // memutar splash lagi.
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBe("1");

    act(() => root.unmount());
  });

  it("mode normal (motion penuh) menahan fade selama FADE_MS", async () => {
    reduceMotion = false;
    const Splash = await loadComponent();
    const { root } = mount(Splash);

    // hold = 1000ms, fade = 500ms.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // Splash masih dirender selama fase fade — opacity-0 tapi node
    // belum di-unmount.
    const midFade = splashNode();
    expect(midFade).not.toBeNull();
    expect(midFade!.className).toContain("opacity-0");
    expect(midFade!.getAttribute("style") ?? "").toContain("transition-duration: 500ms");

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(splashNode()).toBeNull();

    act(() => root.unmount());
  });
});

describe("ChatModeSplash · konsistensi antar-navigasi", () => {
  it("remount di session yang sama TIDAK menampilkan splash lagi", async () => {
    reduceMotion = true;
    const Splash = await loadComponent();

    // Mount pertama: splash tampil lalu selesai.
    const first = mount(Splash);
    expect(splashNode()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(splashNode()).toBeNull();
    act(() => first.root.unmount());
    // Pastikan sessionStorage-nya tercatat — inilah kontrak konsistensi.
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBe("1");

    // Mount kedua (mensimulasikan pindah halaman): splash TIDAK
    // muncul lagi meskipun `mcm.chat.splashShown` di sessionStorage
    // hadir. Tidak ada `document.body` node baru untuk splash.
    const second = mount(Splash);
    // Jalankan semua timer — kalau splash akan ditampilkan,
    // node-nya sudah ada di sini.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(splashNode()).toBeNull();
    act(() => second.root.unmount());
  });

  it("session baru (sessionStorage kosong, flag modul reset) menampilkan splash lagi", async () => {
    reduceMotion = true;
    // Simulasi session baru: sessionStorage sudah dibersihkan di
    // beforeEach, dan `loadModule()` fresh-import ChatModeSplash
    // sehingga flag modul `shownThisSession` reset.
    const Splash = await loadComponent();
    const { root } = mount(Splash);
    expect(splashNode()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(splashNode()).toBeNull();
    act(() => root.unmount());
  });

  it("mode non-chat tidak pernah menampilkan splash apapun", async () => {
    chatOnly = false;
    reduceMotion = false;
    const Splash = await loadComponent();
    const { root } = mount(Splash);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(splashNode()).toBeNull();
    // Session storage juga tidak dicemari.
    expect(window.sessionStorage.getItem("mcm.chat.splashShown")).toBeNull();
    act(() => root.unmount());
  });
});