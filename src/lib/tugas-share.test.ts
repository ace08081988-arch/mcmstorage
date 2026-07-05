import { describe, it, expect } from "vitest";
import { buildTugasBaruWaMessage, validateTugasBaruWaMessage } from "./tugas-share";
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

describe("buildTugasBaruWaMessage dengan daftar items", () => {
  const base = {
    title: "Tugas siapkan barang",
    pin: "962886",
    url: "https://mcmstorage.biz/t/abcdefgh1234",
  } as const;

  it("menampilkan baris Foto per item dengan qty & unit", () => {
    const msg = buildTugasBaruWaMessage({
      ...base,
      items: [
        { name: "Beras Premium", qty: 5, unit: "kg" },
        { name: "Gula Pasir", qty: 2, unit: "kg" },
      ],
    });
    expect(msg).toMatch(/Foto: Beras Premium — 5 kg/);
    expect(msg).toMatch(/Foto: Gula Pasir — 2 kg/);
    expect(msg).toContain("(2 barang)");
  });

  it("mengabaikan item kosong", () => {
    const msg = buildTugasBaruWaMessage({
      ...base,
      items: [{ name: "Beras", qty: 1, unit: "kg" }, { name: "  ", qty: 1, unit: "" }],
    });
    expect(msg).toContain("(1 barang)");
    expect(msg).toMatch(/Foto: Beras/);
  });
});

describe("validateTugasBaruWaMessage", () => {
  const base = {
    title: "Tugas siapkan barang",
    pin: "962886",
    url: "https://mcmstorage.biz/t/abcdefgh1234",
  } as const;

  it("meloloskan pesan lengkap dengan daftar item", () => {
    const items = [
      { name: "Beras Premium", qty: 5, unit: "kg" },
      { name: "Gula Pasir", qty: 2, unit: "kg" },
    ];
    const msg = buildTugasBaruWaMessage({ ...base, items });
    const res = validateTugasBaruWaMessage(msg, { ...base, items });
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
  });

  it("menandai instruksi foto yang hilang", () => {
    const msg = buildTugasBaruWaMessage(base).replace(/\*Foto\* setiap barang[^\n]*/i, "(dihapus)");
    const res = validateTugasBaruWaMessage(msg, base);
    expect(res.ok).toBe(false);
    expect(res.issues.join(" ")).toMatch(/foto/i);
  });

  it("menandai instruksi link Google Maps yang hilang", () => {
    const msg = buildTugasBaruWaMessage(base).replace(/link Google Maps[^\n]*/i, "(dihapus)");
    const res = validateTugasBaruWaMessage(msg, base);
    expect(res.ok).toBe(false);
    expect(res.issues.join(" ")).toMatch(/Google Maps/i);
  });

  it("menandai barang yang tidak muncul di baris foto", () => {
    // Bangun pesan tanpa items → daftar per-item tidak ada, tapi validator
    // diminta memeriksa item "Beras" → harus mengeluh.
    const msg = buildTugasBaruWaMessage(base);
    const res = validateTugasBaruWaMessage(msg, { ...base, items: [{ name: "Beras" }] });
    expect(res.ok).toBe(false);
    expect(res.issues.join(" ")).toMatch(/Beras/);
  });

  it("menandai judul/PIN/URL yang hilang", () => {
    const msg = "pesan kosong tanpa apa-apa";
    const res = validateTugasBaruWaMessage(msg, base);
    expect(res.ok).toBe(false);
    expect(res.issues.length).toBeGreaterThanOrEqual(3);
  });
});