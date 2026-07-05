import { describe, it, expect } from "vitest";
import { buildTugasBaruWaMessage } from "./tugas-share";
import { publicTaskUrl } from "./prep";

describe("buildTugasBaruWaMessage", () => {
  const base = {
    title: "Tugas siapkan barang",
    pin: "962886",
    url: "https://mcmstorage.biz/t/abcdefgh1234",
  } as const;

  it("selalu memuat instruksi foto tiap barang", () => {
    const msg = buildTugasBaruWaMessage(base);
    expect(msg).toMatch(/\*Foto\* setiap barang/);
  });

  it("mencantumkan jumlah barang bila diketahui", () => {
    const msg = buildTugasBaruWaMessage({ ...base, itemsCount: 3 });
    expect(msg).toContain("(3 barang)");
  });

  it("selalu memuat instruksi kirim link Google Maps", () => {
    const msg = buildTugasBaruWaMessage(base);
    expect(msg).toMatch(/link Google Maps/i);
  });

  it("memuat judul, PIN, dan URL tugas", () => {
    const msg = buildTugasBaruWaMessage(base);
    expect(msg).toContain(base.title);
    expect(msg).toContain(base.pin);
    expect(msg).toContain(base.url);
  });

  it("URL yang disematkan berasal dari publicTaskUrl yang valid", () => {
    const token = "abcdefgh1234ABCD";
    const url = publicTaskUrl(token);
    const msg = buildTugasBaruWaMessage({ ...base, url });
    // Harus mengandung path /t/<token> — memastikan link yang dikirim
    // ke pegawai adalah link tugas yang benar, bukan halaman lain.
    expect(msg).toMatch(new RegExp(`/t/${token}(?:#|\\b)`));
  });

  it("langkah-langkah bernomor 1..5 dalam urutan", () => {
    const msg = buildTugasBaruWaMessage(base);
    const idx = [1, 2, 3, 4, 5].map((n) => msg.indexOf(`${n}) `));
    expect(idx.every((i) => i >= 0)).toBe(true);
    for (let i = 1; i < idx.length; i++) {
      expect(idx[i]).toBeGreaterThan(idx[i - 1]);
    }
  });
});