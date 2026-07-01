import { describe, it, expect } from "vitest";
import { formatDurationMMSS } from "./format-duration";

describe("formatDurationMMSS", () => {
  it("mengembalikan '00:00' untuk input invalid / non-positif", () => {
    expect(formatDurationMMSS(null)).toBe("00:00");
    expect(formatDurationMMSS(undefined)).toBe("00:00");
    expect(formatDurationMMSS(Number.NaN)).toBe("00:00");
    expect(formatDurationMMSS(Number.POSITIVE_INFINITY)).toBe("00:00");
    expect(formatDurationMMSS(-1)).toBe("00:00");
    expect(formatDurationMMSS(0)).toBe("00:00");
  });

  it("selalu zero-padded pada menit dan detik", () => {
    expect(formatDurationMMSS(1)).toBe("00:01");
    expect(formatDurationMMSS(9)).toBe("00:09");
    expect(formatDurationMMSS(59)).toBe("00:59");
    expect(formatDurationMMSS(60)).toBe("01:00");
    expect(formatDurationMMSS(65)).toBe("01:05");
    expect(formatDurationMMSS(600)).toBe("10:00");
    expect(formatDurationMMSS(3599)).toBe("59:59");
  });

  it("floor pada fraksi detik", () => {
    expect(formatDurationMMSS(0.9)).toBe("00:00");
    expect(formatDurationMMSS(1.9)).toBe("00:01");
    expect(formatDurationMMSS(59.999)).toBe("00:59");
    expect(formatDurationMMSS(60.4)).toBe("01:00");
  });

  it("mendukung durasi ≥ 60 menit tanpa memotong digit menit", () => {
    expect(formatDurationMMSS(3600)).toBe("60:00");
    expect(formatDurationMMSS(6125)).toBe("102:05");
  });
});