import { describe, it, expect } from "vitest";
import { computeVoiceNoteLabel, normalizeDurationSec } from "./VoiceNotePlayer";

/**
 * Kontrak label voice note (mm:ss zero-padded, minimum 00:01):
 *
 *  1. Bila `initial` (durasi server ternormalisasi) tersedia, label WAJIB
 *     tetap "00:0X" bahkan sebelum audio siap — tidak boleh flash "00:00".
 *  2. Setelah remount, `durationSec` dari server dinormalisasi ke `initial`
 *     dan langsung dipakai sebagai label — TIDAK boleh melompat ke "00:00"
 *     lalu balik lagi.
 *  3. Durasi sub-detik (mis. 0.4s) dinormalisasi ke 1 → label "00:01".
 */
describe("computeVoiceNoteLabel", () => {
  const IDLE = { playing: false, current: 0, ready: false, duration: 0 };

  it("selalu menampilkan minimal 00:01 saat durationSec sub-detik", () => {
    // Alur pengirim: recorder mengukur 0.4s → normalize → 1 → dikirim
    // sebagai attachment_duration_sec.
    const initial = normalizeDurationSec(0.4)!;
    expect(initial).toBe(1);
    expect(computeVoiceNoteLabel({ ...IDLE, initial })).toBe("00:01");
  });

  it.each([
    [0.01, "00:01"],
    [0.5, "00:01"],
    [1, "00:01"],
    [1.4, "00:01"],
    [1.5, "00:02"],
    [3, "00:03"],
    [65, "01:05"],
  ])("initial dari durationSec=%s → label %s", (input, expected) => {
    const initial = normalizeDurationSec(input)!;
    expect(computeVoiceNoteLabel({ ...IDLE, initial })).toBe(expected);
  });

  it("tidak menampilkan 00:00 saat audio belum siap tapi initial tersedia", () => {
    const label = computeVoiceNoteLabel({ ...IDLE, initial: 3 });
    expect(label).toBe("00:03");
    expect(label).not.toBe("00:00");
  });

  it("tetap kanonik saat audio 'ready' dengan durasi berbeda — server menang", () => {
    // Metadata audio boleh melaporkan durasi berbeda (mis. 3.02s); label
    // tetap dikunci ke initial supaya konsisten lintas remount.
    const label = computeVoiceNoteLabel({
      playing: false,
      current: 0,
      ready: true,
      duration: 3.02,
      initial: 3,
    });
    expect(label).toBe("00:03");
  });

  it("saat memutar → tampilkan posisi saat ini, bukan initial", () => {
    expect(
      computeVoiceNoteLabel({ playing: true, current: 2, ready: true, duration: 10, initial: 10 }),
    ).toBe("00:02");
    // current > 0 walau paused → tetap tampilkan posisi (pause di tengah).
    expect(
      computeVoiceNoteLabel({ playing: false, current: 4, ready: true, duration: 10, initial: 10 }),
    ).toBe("00:04");
  });

  it("fallback ke durasi audio hanya bila initial tidak tersedia", () => {
    expect(
      computeVoiceNoteLabel({ playing: false, current: 0, ready: true, duration: 7, initial: 0 }),
    ).toBe("00:07");
  });

  it("tidak ada info apa pun → '—:—', bukan '00:00'", () => {
    const label = computeVoiceNoteLabel({ ...IDLE, initial: 0 });
    expect(label).toBe("—:—");
    expect(label).not.toBe("00:00");
  });

  it("simulasi remount: durationSec berubah dari null → 3 → 5 tanpa melompat ke 00:00", () => {
    // Urutan yang terjadi saat baris virtualized di-remount: prop
    // `durationSec` sempat undefined sebentar, lalu tiba nilai server.
    const seq: Array<number | null | undefined> = [undefined, null, 3, 3, 5, 5];
    const labels = seq.map((v) => {
      const initial = normalizeDurationSec(v) ?? 0;
      return computeVoiceNoteLabel({ ...IDLE, initial });
    });
    // Setelah nilai server tiba, label WAJIB langsung kanonik dan tidak
    // pernah "00:00" pada indeks yang punya durasi.
    expect(labels).toEqual(["—:—", "—:—", "00:03", "00:03", "00:05", "00:05"]);
    for (const l of labels) expect(l).not.toBe("00:00");
  });

  it("durationSec yang berubah TIDAK menyebabkan label mundur ke nilai lebih kecil bila audio sudah memutar", () => {
    // Saat sedang memutar (current>0), perubahan durationSec dari remount
    // tidak boleh mengganti label ke initial — posisi saat ini tetap tampil.
    const before = computeVoiceNoteLabel({ playing: true, current: 2, ready: true, duration: 5, initial: 5 });
    const afterRemountWithNewInitial = computeVoiceNoteLabel({
      playing: true, current: 2, ready: true, duration: 5, initial: 7,
    });
    expect(before).toBe("00:02");
    expect(afterRemountWithNewInitial).toBe("00:02");
  });
});