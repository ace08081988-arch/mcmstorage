import { describe, it, expect } from "vitest";
import { formatDurationMMSS } from "./format-duration";
import {
  computeVoiceNoteLabel,
  normalizeDurationSec,
} from "@/components/chat/VoiceNotePlayer";

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

  it("edge input: coercion & non-numeric → '00:00'", () => {
    // Cast dipakai agar bisa uji jalur pertahanan runtime meski TS ketat.
    expect(formatDurationMMSS(undefined as unknown as number)).toBe("00:00");
    expect(formatDurationMMSS(null as unknown as number)).toBe("00:00");
    expect(formatDurationMMSS(Number.NEGATIVE_INFINITY)).toBe("00:00");
    expect(formatDurationMMSS(-0.0001)).toBe("00:00");
    expect(formatDurationMMSS(-59)).toBe("00:00");
    expect(formatDurationMMSS(-3600)).toBe("00:00");
    // Numeric string / boolean tidak boleh crash — jalur invalid.
    expect(formatDurationMMSS("3" as unknown as number)).toBe("00:00");
    expect(formatDurationMMSS("" as unknown as number)).toBe("00:00");
    expect(formatDurationMMSS(true as unknown as number)).toBe("00:00");
    expect(formatDurationMMSS({} as unknown as number)).toBe("00:00");
  });

  it("selalu cocok /^\\d{2,}:\\d{2}$/ untuk input valid", () => {
    for (const s of [1, 5, 59, 60, 61, 599, 600, 3599, 3600, 6125]) {
      expect(formatDurationMMSS(s)).toMatch(/^\d{2,}:\d{2}$/);
    }
  });
});

// Kontrak silang: formatDurationMMSS + normalizeDurationSec + computeVoiceNoteLabel.
// Untuk SETIAP raw > 0 (termasuk sub-detik), pipeline WAJIB menghasilkan
// label ≥ "00:01" — tidak pernah "00:00" — dan konsisten dengan
// computeVoiceNoteLabel yang dipakai VoiceNotePlayer.
describe("formatDurationMMSS × normalizeDurationSec — konsistensi ≥1 detik", () => {
  const POSITIVES = [
    0.001, 0.01, 0.1, 0.4, 0.5, 0.9, 0.99, 1, 1.1, 1.5, 2.7, 3.5,
    59.4, 59.6, 60, 60.4, 125.3, 3599.9, 3600, 6125.7,
  ];
  for (const raw of POSITIVES) {
    it(`raw=${raw} → label ≥ "00:01" & konsisten`, () => {
      const norm = normalizeDurationSec(raw);
      expect(norm).not.toBeNull();
      expect(norm! >= 1).toBe(true);
      expect(Number.isInteger(norm!)).toBe(true);

      const direct = formatDurationMMSS(norm!);
      expect(direct).not.toBe("00:00");
      expect(direct).toMatch(/^\d{2,}:\d{2}$/);

      const viaLabel = computeVoiceNoteLabel({
        playing: false,
        current: 0,
        ready: false,
        duration: 0,
        initial: norm!,
      });
      expect(viaLabel).toBe(direct);
      expect(viaLabel).not.toBe("00:00");
    });
  }

  const NON_POSITIVES: Array<number | null | undefined> = [
    null,
    undefined,
    0,
    -0,
    -1,
    -59.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const raw of NON_POSITIVES) {
    it(`raw=${String(raw)} → normalize null & label "—:—" (bukan "00:00")`, () => {
      expect(normalizeDurationSec(raw)).toBeNull();
      const label = computeVoiceNoteLabel({
        playing: false,
        current: 0,
        ready: false,
        duration: 0,
        initial: 0,
      });
      expect(label).toBe("—:—");
      expect(label).not.toBe("00:00");
    });
  }

  it("audio metadata siap tapi durasi 0 (invalid stream) → tetap '—:—'", () => {
    const label = computeVoiceNoteLabel({
      playing: false,
      current: 0,
      ready: true,
      duration: 0,
      initial: 0,
    });
    expect(label).toBe("—:—");
  });

  it("metadata siap dengan durasi valid dipakai walau initial=0", () => {
    const label = computeVoiceNoteLabel({
      playing: false,
      current: 0,
      ready: true,
      duration: 7,
      initial: 0,
    });
    expect(label).toBe(formatDurationMMSS(7));
    expect(label).toBe("00:07");
  });
});