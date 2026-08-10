import { describe, expect, it } from "vitest";
import { isKeyboardGap, keyboardInsetFromGap, KEYBOARD_GAP_THRESHOLD_PX } from "./keyboard-gap";

describe("keyboard-gap SSOT", () => {
  it("gap kecil = toolbar browser, bukan keyboard", () => {
    for (const gap of [0, 40, 80, 120]) {
      expect(isKeyboardGap(gap)).toBe(false);
      expect(keyboardInsetFromGap(gap)).toBe(0);
    }
  });

  it("gap besar = keyboard", () => {
    for (const gap of [121, 280, 320]) {
      expect(isKeyboardGap(gap)).toBe(true);
      expect(keyboardInsetFromGap(gap)).toBe(gap);
    }
  });

  it("ambang tunggal 120px", () => {
    expect(KEYBOARD_GAP_THRESHOLD_PX).toBe(120);
  });
});
