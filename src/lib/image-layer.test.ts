import { describe, it, expect } from "vitest";
import { fitWithin, validateImageFile, outputMimeFor, IMAGE_LAYER_MAX_DIM } from "./image-layer";

function fakeFile(name: string, type: string, size: number): File {
  return { name, type, size } as unknown as File;
}

describe("fitWithin — downscale foto tambahan", () => {
  it("menurunkan sisi terpanjang ke 1600px dan menjaga rasio", () => {
    const r = fitWithin(4000, 3000);
    expect(Math.max(r.w, r.h)).toBe(IMAGE_LAYER_MAX_DIM);
    expect(r.w / r.h).toBeCloseTo(4000 / 3000, 2);
  });
  it("tidak pernah memperbesar foto kecil", () => {
    expect(fitWithin(320, 240)).toEqual({ w: 320, h: 240 });
  });
  it("aman untuk dimensi tidak valid", () => {
    expect(fitWithin(0, 100)).toEqual({ w: 0, h: 0 });
  });
});

describe("validateImageFile", () => {
  it("menolak file kosong dengan pesan Indonesia", () => {
    const r = validateImageFile(fakeFile("a.jpg", "image/jpeg", 0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/kosong/i);
  });
  it("menolak tipe non-gambar", () => {
    const r = validateImageFile(fakeFile("a.pdf", "application/pdf", 1234));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/bukan foto/i);
  });
  it("menerima jpeg/png/heic dan tipe kosong dari WebView", () => {
    for (const t of ["image/jpeg", "image/png", "image/heic", ""]) {
      expect(validateImageFile(fakeFile("a", t, 10)).ok).toBe(true);
    }
  });
  it("menolak ketika tidak ada file", () => {
    expect(validateImageFile(null).ok).toBe(false);
  });
});

describe("outputMimeFor", () => {
  it("mempertahankan PNG, sisanya JPEG", () => {
    expect(outputMimeFor(fakeFile("a.png", "image/png", 1))).toBe("image/png");
    expect(outputMimeFor(fakeFile("a.jpg", "image/jpeg", 1))).toBe("image/jpeg");
  });
});
