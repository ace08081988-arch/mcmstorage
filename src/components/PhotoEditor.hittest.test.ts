import { describe, it, expect } from "vitest";
import { insideLayer, type Layer } from "./PhotoEditor";

/**
 * Regresi UX mobile: `insideLayer` harus MEMAAFKAN tap jari yang tidak
 * tepat di atas geometri layer. Sebelum perbaikan, panah tipis 6 px dan
 * coretan hampir mustahil di-select di ponsel — user melapor
 * "Tidak bisa di sentuh semua" saat tool = Pilih.
 *
 * Test ini membekukan toleransi tap: setiap layer harus dapat dipilih
 * dari jarak beberapa piksel di luar geometri visualnya, DAN tap jauh
 * (> HIT_PAD + ketebalan) tetap harus MELESET agar tidak salah pilih.
 */

const base = { id: "1", rotation: 0, scale: 1, color: "#000", opacity: 1 } as const;

describe("insideLayer — arrow (segmen ekor→ujung + toleransi)", () => {
  // Panah horizontal ke kanan di (200, 200), panjang 80, thickness 6.
  // Ekor ~(160, 200), ujung ~(240, 200).
  const l: Layer = { ...base, kind: "arrow", x: 200, y: 200, dir: "right", size: 80, thickness: 6 };

  it("tap tepat di tengah shaft → hit", () => {
    expect(insideLayer(l, { x: 200, y: 200 })).toBe(true);
  });

  it("tap di sepanjang shaft (dekat ekor) → hit", () => {
    expect(insideLayer(l, { x: 165, y: 200 })).toBe(true);
  });

  it("tap di sepanjang shaft (dekat ujung) → hit", () => {
    expect(insideLayer(l, { x: 235, y: 200 })).toBe(true);
  });

  it("tap 10 px MELESET di atas/bawah shaft → hit (toleransi jari)", () => {
    expect(insideLayer(l, { x: 200, y: 190 })).toBe(true);
    expect(insideLayer(l, { x: 200, y: 210 })).toBe(true);
  });

  it("tap 40 px jauh dari shaft → tidak hit", () => {
    expect(insideLayer(l, { x: 200, y: 260 })).toBe(false);
  });

  it("panah diagonal (upright) tetap bisa di-tap di sepanjang shaft", () => {
    const d: Layer = { ...base, kind: "arrow", x: 200, y: 200, dir: "upright", size: 100, thickness: 6 };
    // Titik di antara ekor (~229,229) dan ujung (~171,171) — di tengah shaft.
    expect(insideLayer(d, { x: 200, y: 200 })).toBe(true);
    expect(insideLayer(d, { x: 210, y: 210 })).toBe(true);
    // Tap jauh dari garis diagonal
    expect(insideLayer(d, { x: 260, y: 200 })).toBe(false);
  });
});

describe("insideLayer — stroke (jarak ke segmen antar titik)", () => {
  const l: Layer = {
    ...base, kind: "stroke", x: 0, y: 0, thickness: 4,
    points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }],
  };

  it("tap di titik yang tercatat → hit", () => {
    expect(insideLayer(l, { x: 100, y: 100 })).toBe(true);
    expect(insideLayer(l, { x: 200, y: 200 })).toBe(true);
  });

  it("tap di TENGAH segmen (di antara titik sampel) → hit", () => {
    // Sebelum perbaikan, hanya jarak ke titik sampel yang diuji — titik
    // di tengah segmen panjang bisa lolos. Sekarang wajib hit.
    expect(insideLayer(l, { x: 150, y: 100 })).toBe(true);
    expect(insideLayer(l, { x: 200, y: 150 })).toBe(true);
  });

  it("tap 10 px di sebelah garis → hit (toleransi jari)", () => {
    expect(insideLayer(l, { x: 150, y: 108 })).toBe(true);
  });

  it("tap 50 px dari garis → tidak hit", () => {
    expect(insideLayer(l, { x: 150, y: 160 })).toBe(false);
  });

  it("coretan 1-titik tetap bisa di-tap dalam radius toleransi", () => {
    const dot: Layer = {
      ...base, kind: "stroke", x: 0, y: 0, thickness: 4,
      points: [{ x: 100, y: 100 }],
    };
    expect(insideLayer(dot, { x: 108, y: 100 })).toBe(true);
    expect(insideLayer(dot, { x: 140, y: 100 })).toBe(false);
  });
});

describe("insideLayer — text/emoji/rect/circle (bbox + toleransi)", () => {
  it("text: tap sedikit di luar bbox tetap hit karena HIT_PAD", () => {
    const t: Layer = {
      ...base, kind: "text", x: 100, y: 100, text: "AB", size: 20, bold: true,
    };
    // Baseline di y=100, tinggi 24 → bbox y ∈ [76, 100]. Tap y=108 di luar
    // bbox lama TAPI dalam HIT_PAD.
    expect(insideLayer(t, { x: 105, y: 108 })).toBe(true);
    // Tap sangat jauh → tetap meleset.
    expect(insideLayer(t, { x: 300, y: 300 })).toBe(false);
  });

  it("emoji: bbox size×size di sekitar (x,y) + HIT_PAD", () => {
    const e: Layer = { ...base, kind: "emoji", x: 100, y: 100, emoji: "⭐", size: 20 };
    expect(insideLayer(e, { x: 100, y: 100 })).toBe(true);
    expect(insideLayer(e, { x: 118, y: 118 })).toBe(true); // di luar 10 px, dalam 14 px
    expect(insideLayer(e, { x: 180, y: 100 })).toBe(false);
  });

  it("rect & circle: pad melebar seragam", () => {
    const r: Layer = { ...base, kind: "rect", x: 100, y: 100, w: 40, h: 40, thickness: 2, fill: false };
    expect(insideLayer(r, { x: 96, y: 96 })).toBe(true);   // di luar rect asli
    expect(insideLayer(r, { x: 160, y: 160 })).toBe(false);
    const c: Layer = { ...base, kind: "circle", x: 100, y: 100, r: 20, thickness: 2, fill: false };
    expect(insideLayer(c, { x: 130, y: 100 })).toBe(true); // 10 px di luar radius
    expect(insideLayer(c, { x: 150, y: 100 })).toBe(false);
  });
});
