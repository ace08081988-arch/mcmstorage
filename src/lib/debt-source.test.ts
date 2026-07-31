import { describe, it, expect } from "vitest";
import { assertDebtSource, DEBT_SOURCES } from "./debt-source";

describe("assertDebtSource", () => {
  it("menerima semua nilai allowlist", () => {
    for (const s of DEBT_SOURCES) {
      expect(assertDebtSource(s)).toBe(s);
    }
  });

  it.each([
    ["chat"],
    [""],
    ["MANUAL"],
    ["Purchase"],
    ["ecer-prep"],
  ])("menolak nilai tidak valid: %s", (input) => {
    expect(() => assertDebtSource(input)).toThrow(/tidak valid/);
  });
});
