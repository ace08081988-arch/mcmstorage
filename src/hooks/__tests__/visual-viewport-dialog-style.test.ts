/**
 * Regresi: dialog TIDAK boleh melorot / terpotong di WebView Android.
 *
 * `visualViewportDialogStyle` menghasilkan `top` + `maxHeight` untuk kartu
 * dialog `position: fixed`. Kontraknya:
 *   1. Kartu tidak pernah melampaui layout viewport (atas & bawah).
 *   2. Bila kartu muat di area terlihat, kartu HARUS seluruhnya berada di
 *      dalam area terlihat (top … top+height) — inilah kasus "melorot ke
 *      balik keyboard / bawah layar".
 *   3. `maxHeight` tidak pernah melebihi tinggi area terlihat.
 */
import { describe, expect, it } from "vitest";
import { visualViewportDialogStyle, type VisualViewportBox } from "../use-visual-viewport-inset";

function geom(box: VisualViewportBox) {
  const s = visualViewportDialogStyle(box)!;
  const top = parseFloat(s.top);
  const maxH = parseFloat(s.maxHeight);
  return { center: top, maxH, cardTop: top - maxH / 2, cardBottom: top + maxH / 2 };
}

function assertContract(box: VisualViewportBox, label: string) {
  const g = geom(box);
  // 1) di dalam layout viewport
  expect(g.cardTop, `${label}: atas kartu ≥ 0`).toBeGreaterThanOrEqual(-1);
  expect(g.cardBottom, `${label}: bawah kartu ≤ layout`).toBeLessThanOrEqual(box.layout + 1);
  // 3) tinggi tidak melebihi area terlihat (kecuali lantai 120px)
  expect(g.maxH, `${label}: maxHeight ≤ area terlihat`).toBeLessThanOrEqual(
    Math.max(120, box.height),
  );
  // 2) muat di area terlihat → harus di dalamnya
  if (g.maxH <= box.height - 16 && box.top + box.height <= box.layout) {
    expect(g.cardTop, `${label}: atas kartu di area terlihat`).toBeGreaterThanOrEqual(box.top - 1);
    expect(g.cardBottom, `${label}: bawah kartu di area terlihat`).toBeLessThanOrEqual(
      box.top + box.height + 1,
    );
  }
}

describe("visualViewportDialogStyle", () => {
  it("tanpa box → biarkan CSS default", () => {
    expect(visualViewportDialogStyle(null)).toBeUndefined();
  });

  it("keyboard Android terbuka (layout tetap tinggi) — kartu tidak melorot", () => {
    // Kasus asli: layout 893, area terlihat cuma 420 teratas.
    const g = geom({ top: 0, height: 420, layout: 893 });
    expect(g.cardBottom).toBeLessThanOrEqual(420);
    expect(g.maxH).toBe(404);
  });

  it("iOS: visualViewport digeser ke bawah (offsetTop)", () => {
    const g = geom({ top: 300, height: 400, layout: 900 });
    expect(g.cardTop).toBeGreaterThanOrEqual(300);
    expect(g.cardBottom).toBeLessThanOrEqual(700);
  });

  it("toolbar Android muncul saat scroll (offsetTop kecil)", () => {
    assertContract({ top: 56, height: 640, layout: 720 }, "toolbar");
  });

  it("landscape sempit 640×360", () => {
    assertContract({ top: 0, height: 300, layout: 360 }, "landscape");
  });

  it("area terlihat ekstrem kecil → lantai 120px tapi tetap di layar", () => {
    const g = geom({ top: 0, height: 90, layout: 800 });
    expect(g.maxH).toBe(120);
    expect(g.cardTop).toBeGreaterThanOrEqual(0);
    expect(g.cardBottom).toBeLessThanOrEqual(800);
  });

  it("fuzz geometri WebView — kontrak selalu terpenuhi", () => {
    let n = 0;
    for (const layout of [360, 411, 640, 720, 800, 893, 1024]) {
      for (const height of [90, 180, 240, 320, 411, 560, 700, 893]) {
        if (height > layout) continue;
        for (const top of [0, 24, 56, 120, 300]) {
          if (top + height > layout) continue;
          assertContract({ top, height, layout }, `L${layout}/H${height}/T${top}`);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(30);
  });
});
