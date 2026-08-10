// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import {
  useViewportAnchor,
  VIEWPORT_ANCHOR_VAR,
  VIEWPORT_ANCHOR_LOCK_VAR,
} from "@/lib/use-viewport-anchor";

/** Emulasi visualViewport ala Android WebView. */
function installViewport(layoutH: number) {
  const listeners: Record<string, Set<() => void>> = { resize: new Set(), scroll: new Set() };
  const vv = {
    height: layoutH,
    offsetTop: 0,
    addEventListener: (t: string, fn: () => void) => listeners[t]?.add(fn),
    removeEventListener: (t: string, fn: () => void) => listeners[t]?.delete(fn),
  };
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  Object.defineProperty(document.documentElement, "clientHeight", {
    value: layoutH,
    configurable: true,
  });
  return {
    vv,
    emit(type: "resize" | "scroll") {
      listeners[type].forEach((fn) => fn());
    },
  };
}

function flushFrames(n = 30) {
  for (let i = 0; i < n; i++) {
    const cbs = (globalThis as any).__raf as Array<() => void>;
    (globalThis as any).__raf = [];
    cbs.forEach((cb) => cb());
  }
}

function Probe({ lock }: { lock: boolean }) {
  const { keyboardOpen } = useViewportAnchor({ lock });
  return <div data-testid="kb">{String(keyboardOpen)}</div>;
}

const read = (name: string) => document.documentElement.style.getPropertyValue(name);

let now = 0;

beforeEach(() => {
  now = 0;
  (globalThis as any).__raf = [];
  globalThis.requestAnimationFrame = ((cb: () => void) => {
    (globalThis as any).__raf.push(cb);
    return 1;
  }) as any;
  globalThis.cancelAnimationFrame = (() => {}) as any;
  globalThis.performance.now = () => now;
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("style");
});

// Ukuran layar Android umum (CSS px) — kecil, sedang, besar/tablet.
const SCREENS = [
  { name: "compact 360x640", h: 640 },
  { name: "standard 412x915", h: 915 },
  { name: "tablet 800x1280", h: 1280 },
];

describe("viewport anchor — Android WebView", () => {
  for (const s of SCREENS) {
    it(`${s.name}: address bar menyusut saat scroll → bar tetap menempel dasar layar`, () => {
      const env = installViewport(s.h);
      render(<Probe lock={false} />);
      act(() => flushFrames(2));
      expect(read(VIEWPORT_ANCHOR_VAR)).toBe("0px");

      // User menggulir; Chrome menyembunyikan address bar (56–120px).
      // Layout viewport tetap `s.h`, jadi bar `fixed bottom:0` akan
      // terdorong keluar layar sebesar selisihnya → offset harus sama
      // besar supaya bar kembali menempel ke dasar layar yang terlihat.
      for (const chrome of [56, 96, 120]) {
        act(() => {
          now += 50;
          env.emit("scroll");
          env.vv.height = s.h - chrome;
          env.emit("resize");
          flushFrames(3);
        });
        expect(read(VIEWPORT_ANCHOR_VAR)).toBe(`${chrome}px`);
        // Mode terkunci ikut mengoreksi address bar (keyboard tertutup).
        expect(read(VIEWPORT_ANCHOR_LOCK_VAR)).toBe(`${chrome}px`);
      }

      // Address bar kembali muncul.
      act(() => {
        now += 50;
        env.emit("scroll");
        env.vv.height = s.h;
        env.emit("resize");
        flushFrames(3);
      });
      expect(read(VIEWPORT_ANCHOR_VAR)).toBe("0px");
      expect(read(VIEWPORT_ANCHOR_LOCK_VAR)).toBe("0px");
    });

    it(`${s.name}: keyboard terbuka → kompensasi aktif, lock tetap 0`, () => {
      const env = installViewport(s.h);
      const view = render(<Probe lock={true} />);
      act(() => flushFrames(2));

      // Keyboard muncul tanpa scroll (shrink besar).
      act(() => {
        now += 1000; // jauh dari jendela grace scroll
        env.vv.height = s.h - 320;
        env.emit("resize");
        flushFrames(3);
      });
      expect(read(VIEWPORT_ANCHOR_VAR)).toBe("320px");
      expect(read(VIEWPORT_ANCHOR_LOCK_VAR)).toBe("0px");
      expect(view.getByTestId("kb").textContent).toBe("true");

      // Keyboard tertutup.
      act(() => {
        now += 1000;
        env.vv.height = s.h;
        env.emit("resize");
        flushFrames(3);
      });
      expect(read(VIEWPORT_ANCHOR_VAR)).toBe("0px");
      expect(view.getByTestId("kb").textContent).toBe("false");
    });
  }

  it("shrink besar tepat setelah scroll tetap diklasifikasi address bar (bukan keyboard) bila <= 180px", () => {
    const env = installViewport(915);
    const view = render(<Probe lock={false} />);
    act(() => flushFrames(2));
    act(() => {
      now += 10;
      env.emit("scroll");
      env.vv.height = 915 - 170;
      env.emit("resize");
      flushFrames(3);
    });
    // Diklasifikasi sebagai address bar → keyboard TIDAK dianggap terbuka
    // (bar tidak disembunyikan), tapi posisinya tetap dikoreksi.
    expect(view.getByTestId("kb").textContent).toBe("false");
    expect(read(VIEWPORT_ANCHOR_VAR)).toBe("170px");
  });
});
