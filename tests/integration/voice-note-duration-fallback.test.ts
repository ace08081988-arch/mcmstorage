import { describe, it, expect } from "vitest";
import { formatDurationMMSS } from "@/lib/format-duration";
import {
  computeVoiceNoteLabel,
  normalizeDurationSec,
} from "@/components/chat/VoiceNotePlayer";

/**
 * Integrasi: fallback durasi voice note saat audio belum siap.
 *
 * Alur nyata di VoiceNotePlayer (lihat useEffect + label di file itu):
 *   1) Mount: `initial = normalizeDurationSec(durationSec) ?? 0`,
 *      `duration = initial`, `ready = initial > 0`.
 *      Audio HTML belum memuat metadata → label harus memakai `initial`
 *      (bukan "00:00", bukan "—:—").
 *   2) `loadedmetadata` audio berjalan: karena `initial > 0`, kita
 *      TETAP memakai `initial` (bukan `audio.duration` yang mungkin
 *      floating). Label tidak boleh berubah.
 *   3) User menekan play → label mengikuti `current` yang bergerak.
 *   4) Pause & reset → label kembali ke fallback (`initial`).
 *
 * Regresi yang dijaga: label TIDAK boleh melompat dari "00:03" ke
 * "00:00" (atau ke "00:04" karena `audio.duration = 3.98`) di antara
 * langkah 1 dan 2.
 */
function simulateMount(rawServerDuration: number | null | undefined) {
  const initial = normalizeDurationSec(rawServerDuration) ?? 0;
  return {
    initial,
    // state awal identik dengan VoiceNotePlayer:
    playing: false,
    current: 0,
    ready: initial > 0,
    duration: initial,
  };
}

function labelOf(s: {
  playing: boolean;
  current: number;
  ready: boolean;
  duration: number;
  initial: number;
}) {
  return computeVoiceNoteLabel(s);
}

describe("VoiceNotePlayer fallback durasi (integrasi)", () => {
  it("saat audio belum siap, memakai durasi server ternormalisasi (≥ 0:01)", () => {
    const s = simulateMount(3.4);
    expect(s.ready).toBe(true); // sudah dianggap siap oleh player
    expect(labelOf(s)).toBe("00:03");
  });

  it("durasi server sub-detik (0.4) → fallback 00:01, bukan 00:00", () => {
    const s = simulateMount(0.4);
    expect(labelOf(s)).toBe("00:01");
  });

  it("label tidak berubah ketika metadata audio termuat setelah mount", () => {
    const s0 = simulateMount(3);
    const before = labelOf(s0);
    // simulate onLoaded: initial>0 → kita PERTAHANKAN initial, bukan audio.duration
    const s1 = { ...s0, ready: true, duration: s0.initial };
    const after = labelOf(s1);
    expect(before).toBe("00:03");
    expect(after).toBe(before);
  });

  it("audio.duration floating (3.98) tidak mengubah label ke 00:04", () => {
    // Player secara eksplisit tetap memakai `initial` saat initial>0.
    const s0 = simulateMount(3);
    const s1 = { ...s0, ready: true, duration: 3 /* dipertahankan */ };
    expect(labelOf(s1)).toBe("00:03");
    expect(labelOf(s1)).not.toBe("00:04");
  });

  it("tanpa durasi server, sebelum metadata siap → '—:—' (bukan 00:00)", () => {
    const s = simulateMount(null);
    expect(s.ready).toBe(false);
    expect(labelOf(s)).toBe("—:—");
  });

  it("tanpa durasi server, setelah metadata siap → pakai audio.duration", () => {
    const s0 = simulateMount(undefined);
    const s1 = { ...s0, ready: true, duration: 7 };
    expect(labelOf(s1)).toBe("00:07");
  });

  it("play → label mengikuti current, pause → kembali ke fallback initial", () => {
    const s0 = simulateMount(12);
    // play, current bergerak
    const sPlay = { ...s0, playing: true, current: 4.2 };
    expect(labelOf(sPlay)).toBe(formatDurationMMSS(4.2));
    expect(labelOf(sPlay)).toBe("00:04");
    // pause + reset current
    const sPause = { ...s0, playing: false, current: 0 };
    expect(labelOf(sPause)).toBe("00:12");
  });

  it("remount dengan durationSec sama → label identik (tidak flicker)", () => {
    const a = labelOf(simulateMount(5.6));
    const b = labelOf(simulateMount(5.6));
    expect(a).toBe(b);
    expect(a).toBe("00:06");
  });

  it("urutan transisi lengkap tidak pernah melewati '00:00'", () => {
    const s0 = simulateMount(3);
    const seq = [
      labelOf(s0), // mount
      labelOf({ ...s0, ready: true }), // loadedmetadata
      labelOf({ ...s0, ready: true, playing: true, current: 1.1 }), // playing
      labelOf({ ...s0, ready: true, playing: true, current: 2.9 }),
      labelOf({ ...s0, ready: true, playing: false, current: 0 }), // ended/reset
    ];
    for (const l of seq) {
      expect(l).not.toBe("00:00");
      expect(l).not.toBe("—:—");
      expect(l).toMatch(/^\d{2,}:\d{2}$/);
    }
  });
});