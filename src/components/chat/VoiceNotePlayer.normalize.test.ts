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

  // Kasus tambahan: sumber durasi bisa datang dari JSON server (string),
  // metadata audio yang belum siap (NaN), atau field opsional yang hilang
  // (undefined). Aturan pembulatan ≥ 1 detik harus tetap berlaku.
  describe("input tak biasa (undefined / string numerik / NaN)", () => {
    it("mengembalikan null untuk undefined eksplisit maupun implisit", () => {
      expect(normalizeDurationSec(undefined)).toBeNull();
      // Implicit undefined via destructuring optional field.
      const obj: { d?: number } = {};
      expect(normalizeDurationSec(obj.d)).toBeNull();
    });

    it("mengembalikan null untuk NaN dari sumber apa pun", () => {
      expect(normalizeDurationSec(Number.NaN)).toBeNull();
      expect(normalizeDurationSec(0 / 0)).toBeNull();
      expect(normalizeDurationSec(parseFloat("bukan-angka"))).toBeNull();
      // Audio.duration sering NaN sebelum metadata termuat.
      const fakeAudio = { duration: Number.NaN } as HTMLAudioElement;
      expect(normalizeDurationSec(fakeAudio.duration)).toBeNull();
    });

    it("meng-coerce string numerik ke aturan pembulatan yang sama (≥ 1 detik)", () => {
      // String bisa masuk dari payload JSON server yang belum ter-parse.
      // Kontrak: hasil harus identik dengan varian number-nya.
      expect(normalizeDurationSec("0.1" as unknown as number)).toBe(1);
      expect(normalizeDurationSec("0.5" as unknown as number)).toBe(1);
      expect(normalizeDurationSec("1" as unknown as number)).toBe(1);
      expect(normalizeDurationSec("1.4" as unknown as number)).toBe(1);
      expect(normalizeDurationSec("1.5" as unknown as number)).toBe(2);
      expect(normalizeDurationSec("2.7" as unknown as number)).toBe(3);
      expect(normalizeDurationSec("59.6" as unknown as number)).toBe(60);
      expect(normalizeDurationSec("125" as unknown as number)).toBe(125);
    });

    it("mengembalikan null untuk string non-numerik / kosong / whitespace", () => {
      expect(normalizeDurationSec("" as unknown as number)).toBeNull();
      expect(normalizeDurationSec("   " as unknown as number)).toBeNull();
      expect(normalizeDurationSec("abc" as unknown as number)).toBeNull();
      expect(normalizeDurationSec("NaN" as unknown as number)).toBeNull();
      expect(normalizeDurationSec("Infinity" as unknown as number)).toBeNull();
      expect(normalizeDurationSec("-3" as unknown as number)).toBeNull();
      expect(normalizeDurationSec("0" as unknown as number)).toBeNull();
    });

    it("konsisten: string numerik dan number-nya menghasilkan output identik", () => {
      const pairs: Array<[string, number]> = [
        ["0.2", 0.2],
        ["1", 1],
        ["1.5", 1.5],
        ["2.4", 2.4],
        ["59.6", 59.6],
        ["125.3", 125.3],
      ];
      for (const [s, n] of pairs) {
        expect(normalizeDurationSec(s as unknown as number)).toBe(
          normalizeDurationSec(n),
        );
      }
    });
  });
});