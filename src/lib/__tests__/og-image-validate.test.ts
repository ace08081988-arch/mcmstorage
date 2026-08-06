import { describe, expect, it } from "vitest";
import { formatOgImageReport, sniffImage, validateOgImage, validateOgImages } from "../og-image-validate";
import { resolvePolicy } from "../seo-audit-policy";

function pngHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
function jpegHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  b[5] = 0x11;
  b[7] = h >> 8; b[8] = h & 0xff; b[9] = w >> 8; b[10] = w & 0xff;
  return b;
}

const ok = { routeUrl: "https://mcmstorage.app/harga", imageUrl: "https://mcmstorage.app/og.png?v=1", status: 200, contentType: "image/png", bytes: pngHeader(1200, 630) };

describe("sniffImage", () => {
  it("membaca dimensi PNG", () => expect(sniffImage(pngHeader(1200, 630))).toEqual({ format: "png", width: 1200, height: 630 }));
  it("mengenali JPEG", () => expect(sniffImage(jpegHeader(800, 600)).format).toBe("jpeg"));
  it("mengembalikan unknown untuk byte acak", () => expect(sniffImage(new Uint8Array(30)).format).toBe("unknown"));
});

describe("validateOgImage", () => {
  it("lolos untuk PNG 1200x630 status 200", () => expect(validateOgImage(ok)).toEqual([]));

  it("menolak status non-200", () => {
    expect(validateOgImage({ ...ok, status: 404 }).map((i) => i.id)).toEqual(["og:image-status"]);
  });

  it("menolak dimensi salah", () => {
    expect(validateOgImage({ ...ok, bytes: pngHeader(800, 418) }).map((i) => i.id)).toContain("og:image-dimensions");
  });

  it("menolak format non-PNG", () => {
    const ids = validateOgImage({ ...ok, contentType: "image/jpeg", bytes: jpegHeader(1200, 630) }).map((i) => i.id);
    expect(ids).toContain("og:image-content-type");
    expect(ids).toContain("og:image-format");
  });

  it("menolak route tanpa og:image", () => {
    expect(validateOgImage({ routeUrl: "https://mcmstorage.app/x", imageUrl: null, status: 0 })[0].id).toBe("og:image-missing");
  });
});

describe("validateOgImages", () => {
  const policy = resolvePolicy({ exemptions: [{ pattern: "/katalog/*/*", rules: ["og:image-format", "og:image-content-type", "og:image-dimensions"], reason: "foto produk" }] });

  it("menghormati pengecualian kebijakan", () => {
    const report = validateOgImages([
      ok,
      { ...ok, routeUrl: "https://mcmstorage.app/katalog/toko/1", contentType: "image/jpeg", bytes: jpegHeader(1000, 1000) },
    ], policy);
    expect(report.ok).toBe(true);
    expect(report.exempt.length).toBeGreaterThan(0);
    expect(formatOgImageReport(report)).toContain("✅");
  });

  it("gagal saat ada route bermasalah", () => {
    const report = validateOgImages([{ ...ok, status: 500 }], policy);
    expect(report.ok).toBe(false);
  });
});
