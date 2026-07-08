import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVisualViewportKeyboardInset } from "../use-visual-viewport-inset";

/**
 * Regresi: hook harus melacak selisih layout vs visual viewport dan
 * memancarkan ulang saat `orientationchange`, `resize`, atau
 * `visualViewport.resize` — jangan berhenti setelah kejadian pertama.
 */
describe("useVisualViewportKeyboardInset", () => {
  type Listener = () => void;
  const listeners: Record<string, Set<Listener>> = {};
  let innerHeight = 800;
  let vvHeight = 800;
  let vvOffsetTop = 0;

  const flushRaf = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  };

  beforeEach(() => {
    innerHeight = 800;
    vvHeight = 800;
    vvOffsetTop = 0;
    for (const k of Object.keys(listeners)) listeners[k].clear();

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      get: () => innerHeight,
    });

    const vv = {
      get height() { return vvHeight; },
      get offsetTop() { return vvOffsetTop; },
      addEventListener: (ev: string, cb: Listener) => {
        (listeners[`vv:${ev}`] ??= new Set()).add(cb);
      },
      removeEventListener: (ev: string, cb: Listener) => {
        listeners[`vv:${ev}`]?.delete(cb);
      },
    };
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: vv,
    });

    const origAdd = window.addEventListener.bind(window);
    const origRemove = window.removeEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((ev: string, cb: EventListenerOrEventListenerObject) => {
      (listeners[`win:${ev}`] ??= new Set()).add(cb as Listener);
      origAdd(ev, cb);
    });
    vi.spyOn(window, "removeEventListener").mockImplementation((ev: string, cb: EventListenerOrEventListenerObject) => {
      listeners[`win:${ev}`]?.delete(cb as Listener);
      origRemove(ev, cb);
    });

    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(0), 0) as unknown as number;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const fire = (bucket: string) => {
    for (const cb of listeners[bucket] ?? []) cb();
  };

  it("emit 0 saat visual viewport = layout viewport", async () => {
    const { result } = renderHook(() => useVisualViewportKeyboardInset());
    await flushRaf();
    expect(result.current).toBe(0);
  });

  it("melacak keyboard terbuka (visual viewport shrink)", async () => {
    const { result } = renderHook(() => useVisualViewportKeyboardInset());
    await flushRaf();
    vvHeight = 500; // keyboard 300px terbuka
    act(() => fire("vv:resize"));
    await flushRaf();
    expect(result.current).toBe(300);
  });

  it("melacak iOS visualViewport offset (bukan hanya height)", async () => {
    const { result } = renderHook(() => useVisualViewportKeyboardInset());
    await flushRaf();
    vvHeight = 500;
    vvOffsetTop = 100;
    act(() => fire("vv:resize"));
    await flushRaf();
    expect(result.current).toBe(200); // 800 - 500 - 100
  });

  it("kembali ke 0 saat keyboard tertutup", async () => {
    const { result } = renderHook(() => useVisualViewportKeyboardInset());
    vvHeight = 500;
    act(() => fire("vv:resize"));
    await flushRaf();
    expect(result.current).toBe(300);

    vvHeight = 800;
    act(() => fire("vv:resize"));
    await flushRaf();
    expect(result.current).toBe(0);
  });

  it("bereaksi ke orientationchange (portrait → landscape)", async () => {
    const { result } = renderHook(() => useVisualViewportKeyboardInset());
    await flushRaf();
    // Rotasi: layout viewport 800 → 400 (landscape), visual masih 800 sebentar
    innerHeight = 400;
    vvHeight = 400;
    act(() => fire("win:orientationchange"));
    await flushRaf();
    expect(result.current).toBe(0);
    // Lalu keyboard terbuka di landscape
    vvHeight = 250;
    act(() => fire("vv:resize"));
    await flushRaf();
    expect(result.current).toBe(150);
  });

  it("no-op saat visualViewport tidak tersedia (browser lama)", async () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    const { result } = renderHook(() => useVisualViewportKeyboardInset());
    await flushRaf();
    expect(result.current).toBe(0);
  });
});
