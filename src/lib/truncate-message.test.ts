import { describe, expect, it } from "vitest";
import { truncateWords, willTruncate } from "./truncate-message";

describe("truncateWords", () => {
  it("mengembalikan teks pendek apa adanya", () => {
    expect(truncateWords("Halo bos", 140)).toBe("Halo bos");
  });

  it("tidak memotong di tengah kata", () => {
    const out = truncateWords("Penyiapan pesanan kristal untuk pelanggan setia", 20);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.slice(0, -1).split(" ").pop()).toBe("pesanan");
  });

  it("membuang tanda baca ekor sebelum elipsis", () => {
    expect(truncateWords("Sudah lunas, terima kasih banyak sekali", 15)).toBe("Sudah lunas…");
  });

  it("memotong keras token tunggal yang kepanjangan", () => {
    const url = "https://mcmstorage.app/katalog/toko-kifa/produk-sangat-panjang";
    const out = truncateWords(url, 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.startsWith("https://mcmstorage")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("memotong pada newline sebagai batas kata", () => {
    const out = truncateWords("Baris satu\nBaris dua yang jauh lebih panjang", 16);
    expect(out).toBe("Baris satu…");
  });

  it("willTruncate konsisten dengan hasil potong", () => {
    expect(willTruncate("pendek", 140)).toBe(false);
    expect(willTruncate("x".repeat(200), 140)).toBe(true);
  });
});
