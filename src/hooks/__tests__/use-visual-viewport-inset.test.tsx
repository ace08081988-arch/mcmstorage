// @vitest-environment happy-dom
/**
 * Regresi: hook harus melacak selisih layout vs visual viewport dan
 * memancarkan ulang saat `orientationchange`, `resize`, atau
 * `visualViewport.resize` — jangan berhenti setelah kejadian pertama.
 *
 * Memakai createRoot + act (pola yang sama dengan
 * `use-is-admin.token-refresh-null.test.tsx`) supaya tidak butuh
 * @testing-library/react.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useVisualViewportKeyboardInset } from "../use-visual-viewport-inset";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Listener = () => void;
const listeners: Record<string, Set<Listener>> = {};
let innerHeight = 800;
let vvHeight = 800;
let vvOffsetTop = 0;
let lastValue = -1;

function Probe() {
  lastValue = useVisualViewportKeyboardInset();
  return null;
}

let root: Root;
let container: HTMLDivElement;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Probe />); });
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

const fire = (bucket: string) => {
  for (const cb of listeners[bucket] ?? []) cb();
};

beforeEach(() => {
  innerHeight = 800; vvHeight = 800; vvOffsetTop = 0; lastValue = -1;
  for (const k of Object.keys(listeners)) delete listeners[k];

  Object.defineProperty(window, "innerHeight", {
    configurable: true, get: () => innerHeight,
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
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });

  const origAdd = window.addEventListener.bind(window);
  const origRemove = window.removeEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation(((ev: string, cb: EventListenerOrEventListenerObject) => {
    (listeners[`win:${ev}`] ??= new Set()).add(cb as Listener);
    origAdd(ev, cb);
  }) as typeof window.addEventListener);
  vi.spyOn(window, "removeEventListener").mockImplementation(((ev: string, cb: EventListenerOrEventListenerObject) => {
    listeners[`win:${ev}`]?.delete(cb as Listener);
    origRemove(ev, cb);
  }) as typeof window.removeEventListener);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  vi.restoreAllMocks();
});

describe("useVisualViewportKeyboardInset", () => {
  it("emit 0 saat visual viewport = layout viewport", async () => {
    await mount();
    await flush();
    expect(lastValue).toBe(0);
  });

  it("melacak keyboard terbuka (visualViewport shrink)", async () => {
    await mount();
    await flush();
    vvHeight = 500;
    await act(async () => { fire("vv:resize"); });
    await flush();
    expect(lastValue).toBe(300);
  });

  it("melacak iOS visualViewport offset (bukan hanya height)", async () => {
    await mount();
    await flush();
    vvHeight = 500; vvOffsetTop = 100;
    await act(async () => { fire("vv:resize"); });
    await flush();
    expect(lastValue).toBe(200);
  });

  it("kembali ke 0 saat keyboard tertutup", async () => {
    await mount();
    vvHeight = 500;
    await act(async () => { fire("vv:resize"); });
    await flush();
    expect(lastValue).toBe(300);
    vvHeight = 800;
    await act(async () => { fire("vv:resize"); });
    await flush();
    expect(lastValue).toBe(0);
  });

  it("bereaksi ke orientationchange", async () => {
    await mount();
    await flush();
    innerHeight = 400; vvHeight = 400;
    await act(async () => { fire("win:orientationchange"); });
    await flush();
    expect(lastValue).toBe(0);
    vvHeight = 250;
    await act(async () => { fire("vv:resize"); });
    await flush();
    expect(lastValue).toBe(150);
  });

  it("no-op saat visualViewport tidak tersedia", async () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    await mount();
    await flush();
    expect(lastValue).toBe(0);
  });
});
