// @vitest-environment happy-dom
/**
 * Verifikasi sinkronisasi same-tab: mengubah mode di satu instance
 * `useLayoutMode` harus langsung terpantul ke instance lain dengan key
 * yang sama di tab yang sama (mis. toggle di halaman induk → dialog
 * yang sedang terbuka ikut berubah tanpa reload).
 *
 * Sekaligus memastikan key berbeda TIDAK terpengaruh (isolasi tetap).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLayoutMode, type LayoutMode } from "@/components/LayoutModeToggle";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type Probe = { mode: LayoutMode; setMode: (m: LayoutMode) => void };

function Probe({ storageKey, onReady }: { storageKey: string; onReady: (p: Probe) => void }) {
  const [mode, setMode] = useLayoutMode(storageKey);
  onReady({ mode, setMode });
  return null;
}

let containers: HTMLDivElement[] = [];
let roots: Root[] = [];

function mount(key: string): { get: () => Probe } {
  const c = document.createElement("div");
  document.body.appendChild(c);
  const r = createRoot(c);
  containers.push(c);
  roots.push(r);
  let latest: Probe = { mode: "list", setMode: () => {} };
  act(() => {
    r.render(<Probe storageKey={key} onReady={(p) => { latest = p; }} />);
  });
  return { get: () => latest };
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  roots.forEach((r) => act(() => r.unmount()));
  containers.forEach((c) => c.remove());
  roots = [];
  containers = [];
  window.localStorage.clear();
});

describe("useLayoutMode – sinkronisasi same-tab", () => {
  it("toggle di satu instance langsung mengubah instance lain (key sama)", () => {
    const parent = mount("readyEcer");
    const dialog = mount("readyEcer");
    expect(parent.get().mode).toBe("list");
    expect(dialog.get().mode).toBe("list");

    act(() => parent.get().setMode("dense"));

    expect(parent.get().mode).toBe("dense");
    expect(dialog.get().mode).toBe("dense");
  });

  it("instance dengan key berbeda tidak terpengaruh", () => {
    const ecer = mount("readyEcer");
    const request = mount("readyRequest");

    act(() => ecer.get().setMode("compact"));

    expect(ecer.get().mode).toBe("compact");
    expect(request.get().mode).toBe("list");
  });
});