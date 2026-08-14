// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startViewportHeightSync, APP_KEYBOARD_VAR } from "./viewport-height";

let stop: () => void;
let vvHeight = 800;

function setup() {
  Object.defineProperty(window, "innerHeight", { configurable: true, get: () => 800 });
  const listeners = new Set<() => void>();
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: {
      get height() { return vvHeight; },
      offsetTop: 0,
      addEventListener: (_e: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_e: string, cb: () => void) => listeners.delete(cb),
    },
  });
  return () => { for (const cb of listeners) cb(); };
}

let fire: () => void;

beforeEach(() => { vvHeight = 800; fire = setup(); stop = startViewportHeightSync(); });
afterEach(() => stop?.());

const kb = () => document.documentElement.style.getPropertyValue(APP_KEYBOARD_VAR);

async function settle() { await new Promise((r) => setTimeout(r, 60)); }

describe("--app-keyboard-inset memakai SSOT 120px", () => {
  it("gap 80px (toolbar browser) tidak dianggap keyboard", async () => {
    vvHeight = 720; fire(); await settle();
    expect(kb()).toBe("0px");
    expect(document.documentElement.dataset["keyboard"]).toBe("closed");
  });

  it("gap 300px dianggap keyboard", async () => {
    vvHeight = 500; fire(); await settle();
    expect(kb()).toBe("300px");
    expect(document.documentElement.dataset["keyboard"]).toBe("open");
  });
});
