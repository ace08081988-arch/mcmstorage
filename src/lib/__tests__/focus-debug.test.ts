// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  FOCUS_DEBUG_ALLOWED,
  clearFocusDebug,
  describeEl,
  focusDebugLog,
  focusDebugSetLayers,
  getFocusDebugState,
  installFocusDebug,
  isFocusDebugEnabled,
  setFocusDebugEnabled,
} from "@/lib/focus-debug";

describe("mode debug fokus", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    setFocusDebugEnabled(false);
    clearFocusDebug();
    document.body.innerHTML = "";
  });

  it("aktif hanya di dev/test", () => {
    expect(FOCUS_DEBUG_ALLOWED).toBe(true);
  });

  it("tidak mencatat apa pun saat nonaktif", () => {
    focusDebugLog("note", "abaikan");
    expect(getFocusDebugState().events).toHaveLength(0);
    expect(isFocusDebugEnabled()).toBe(false);
  });

  it("mencatat tumpukan layer dan target pemulihan saat aktif", () => {
    setFocusDebugEnabled(true);
    focusDebugSetLayers([
      { layer: 'div role=listbox', trigger: "button testid=pilih-kontak", anchor: { selector: "#a", index: 2 } },
    ]);
    focusDebugLog("layer-open", "buka=div role=listbox");
    focusDebugLog("dialog-close-restore", "target=button testid=kirim-wa");
    const s = getFocusDebugState();
    expect(s.enabled).toBe(true);
    expect(s.events.map((e) => e.type)).toEqual(["layer-open", "dialog-close-restore"]);
    expect(s.events[0]!.layers[0]!.trigger).toBe("button testid=pilih-kontak");
    expect(s.layers).toHaveLength(1);
  });

  it("describeEl memakai testid/id/aria-label", () => {
    document.body.innerHTML =
      '<button data-testid="kirim">a</button><button id="batal">b</button><button aria-label="Tutup">c</button>';
    const [a, b, c] = Array.from(document.querySelectorAll("button"));
    expect(describeEl(a!)).toBe("button testid=kirim");
    expect(describeEl(b!)).toBe("button #batal");
    expect(describeEl(c!)).toBe("button aria=Tutup");
    expect(describeEl(null)).toBeNull();
  });

  it("helper console terpasang dan bisa menyalakan/mematikan", () => {
    installFocusDebug();
    const dbg = (window as any).__waFocusDebug;
    expect(typeof dbg.enable).toBe("function");
    dbg.enable();
    expect(isFocusDebugEnabled()).toBe(true);
    focusDebugLog("note", "x");
    expect(dbg.state().events).toHaveLength(1);
    dbg.disable();
    expect(isFocusDebugEnabled()).toBe(false);
    expect(dbg.state().events).toHaveLength(0);
  });
});
