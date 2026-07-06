// @vitest-environment happy-dom
/**
 * Verifikasi isolasi `useLayoutMode` antar route/section:
 *
 * 1. Setiap key menulis ke slot `localStorage` terpisah
 *    (`mcm.layoutMode.<key>`) — mengubah mode di satu key tidak
 *    mengubah nilai key lain.
 * 2. Hook membaca kembali nilai yang benar per key saat mount.
 * 3. Sinkronisasi antar-tab via event `storage` hanya berlaku untuk
 *    key yang cocok — event dengan key berbeda tidak menggeser mode
 *    di hook lain.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLayoutMode, type LayoutMode } from "@/components/LayoutModeToggle";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_PREFIX = "mcm.layoutMode.";

type Probe = {
  mode: LayoutMode;
  setMode: (m: LayoutMode) => void;
};

function Probe({ storageKey, onReady }: { storageKey: string; onReady: (p: Probe) => void }) {
  const [mode, setMode] = useLayoutMode(storageKey);
  onReady({ mode, setMode });
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
});

function mountProbe(key: string): { get: () => Probe } {
  let latest: Probe = { mode: "list", setMode: () => {} };
  act(() => {
    root.render(<Probe storageKey={key} onReady={(p) => { latest = p; }} />);
  });
  return { get: () => latest };
}

describe("useLayoutMode – isolasi kunci per route", () => {
  it("mengubah mode satu key tidak menyentuh slot key lain", () => {
    // Seed initial values di tiga slot terpisah.
    window.localStorage.setItem(STORAGE_PREFIX + "readyEcer", "grid");
    window.localStorage.setItem(STORAGE_PREFIX + "readyRequest", "dense");
    window.localStorage.setItem(STORAGE_PREFIX + "requestPrep", "compact");

    const ecer = mountProbe("readyEcer");
    expect(ecer.get().mode).toBe("grid");

    // Ubah mode `readyEcer` → seharusnya hanya slot readyEcer yang berubah.
    act(() => ecer.get().setMode("list"));

    expect(window.localStorage.getItem(STORAGE_PREFIX + "readyEcer")).toBe("list");
    expect(window.localStorage.getItem(STORAGE_PREFIX + "readyRequest")).toBe("dense");
    expect(window.localStorage.getItem(STORAGE_PREFIX + "requestPrep")).toBe("compact");
  });

  it("hook membaca nilai per-key saat mount tanpa saling bocor", () => {
    window.localStorage.setItem(STORAGE_PREFIX + "readyEcer", "grid");
    window.localStorage.setItem(STORAGE_PREFIX + "readyRequest", "dense");

    const a = mountProbe("readyEcer");
    expect(a.get().mode).toBe("grid");

    // Mount hook kedua dengan key berbeda di container terpisah.
    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    const root2 = createRoot(container2);
    let bMode: LayoutMode = "list";
    act(() => {
      root2.render(
        <Probe storageKey="readyRequest" onReady={(p) => { bMode = p.mode; }} />,
      );
    });
    expect(bMode).toBe("dense");
    expect(a.get().mode).toBe("grid"); // tidak tergeser

    act(() => root2.unmount());
    container2.remove();
  });

  it("event `storage` untuk key lain tidak menggeser mode hook", () => {
    window.localStorage.setItem(STORAGE_PREFIX + "readyEcer", "grid");
    const ecer = mountProbe("readyEcer");
    expect(ecer.get().mode).toBe("grid");

    // Simulasikan tab lain mengubah key BERBEDA.
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_PREFIX + "readyRequest",
          newValue: "compact",
          oldValue: "list",
          storageArea: window.localStorage,
        }),
      );
    });

    expect(ecer.get().mode).toBe("grid");
  });

  it("event `storage` untuk key yang cocok menyinkronkan mode", () => {
    const ecer = mountProbe("readyEcer");
    expect(ecer.get().mode).toBe("list");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_PREFIX + "readyEcer",
          newValue: "dense",
          oldValue: "list",
          storageArea: window.localStorage,
        }),
      );
    });

    expect(ecer.get().mode).toBe("dense");
  });
});