import { describe, it, expect } from "vitest";
import { normalizeDurationSec } from "./VoiceNotePlayer";

/**
 * Kontrak `normalizeDurationSec`:
 *   - null/undefined/NaN/Infinity/≤0 → null (tidak ada durasi valid).
 *   - Nilai positif berhingga → bilangan bulat ≥ 1, dibulatkan ke integer
 *     terdekat (Math.round) lalu di-clamp minimal 1 detik.
 *
 * Aturan ini dipakai pengirim (VoiceRecorderButton), penyimpan
 * (attachment_duration_sec di DB), dan penampil (VoiceNotePlayer),
 * sehingga label durasi konsisten lintas remount di virtualized list.
 */
describe("normalizeDurationSec", () => {
  it("mengembalikan null untuk input tidak valid", () => {
    expect(normalizeDurationSec(null)).toBeNull();
    expect(normalizeDurationSec(undefined)).toBeNull();
    expect(normalizeDurationSec(Number.NaN)).toBeNull();
    expect(normalizeDurationSec(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeDurationSec(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(normalizeDurationSec(0)).toBeNull();
    expect(normalizeDurationSec(-1)).toBeNull();
    expect(normalizeDurationSec(-0.4)).toBeNull();
  });

  it("meng-clamp durasi sub-detik menjadi minimal 1 detik", () => {
    expect(normalizeDurationSec(0.01)).toBe(1);
    expect(normalizeDurationSec(0.1)).toBe(1);
    expect(normalizeDurationSec(0.49)).toBe(1);
    expect(normalizeDurationSec(0.5)).toBe(1);
    expect(normalizeDurationSec(0.99)).toBe(1);
    // Number.EPSILON positif tetap dianggap "ada audio" — clamp ke 1.
    expect(normalizeDurationSec(Number.EPSILON)).toBe(1);
  });

  it("membulatkan nilai desimal ke integer terdekat (round half → up)", () => {
    expect(normalizeDurationSec(1)).toBe(1);
    expect(normalizeDurationSec(1.2)).toBe(1);
    expect(normalizeDurationSec(1.49)).toBe(1);
    expect(normalizeDurationSec(1.5)).toBe(2); // Math.round: .5 → up
    expect(normalizeDurationSec(1.51)).toBe(2);
    expect(normalizeDurationSec(2.5)).toBe(3);
    expect(normalizeDurationSec(3.499)).toBe(3);
    expect(normalizeDurationSec(3.5)).toBe(4);
    expect(normalizeDurationSec(59.4)).toBe(59);
    expect(normalizeDurationSec(59.6)).toBe(60);
  });

  it("mempertahankan integer besar apa adanya", () => {
    expect(normalizeDurationSec(60)).toBe(60);
    expect(normalizeDurationSec(125)).toBe(125);
    expect(normalizeDurationSec(3600)).toBe(3600);
  });

  it("idempoten: hasil normalize sama jika dinormalisasi ulang", () => {
    const inputs = [0.2, 1, 1.4, 1.5, 2.7, 12.9, 60, 125.3];
    for (const v of inputs) {
      const once = normalizeDurationSec(v);
      expect(normalizeDurationSec(once)).toBe(once);
    }
  });

  it("selalu menghasilkan bilangan bulat untuk input valid", () => {
    const samples = [0.001, 0.6, 1, 1.5, 2.4, 7.777, 15.5, 100.49];
    for (const v of samples) {
      const out = normalizeDurationSec(v);
      expect(out).not.toBeNull();
      expect(Number.isInteger(out as number)).toBe(true);
      expect((out as number) >= 1).toBe(true);
    }
  });
});