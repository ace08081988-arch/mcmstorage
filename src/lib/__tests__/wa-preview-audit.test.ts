import { describe, expect, it } from "vitest";
import { auditWaPreview, auditWaPreviews, hasCacheBuster } from "../wa-preview-audit";

const BASE = "https://mcmstorage.app";
const page = (url: string, head: string) => ({ url, html: `<html><head>${head}</head><body/></html>`, status: 200 });

const goodHead = (u: string, img = `${BASE}/api/public/img/og?slug=toko&item=1&v=1712345678`) => `
  <title>Toko — Ace Storage</title>
  <meta property="og:title" content="Toko">
  <meta property="og:description" content="Katalog Toko">
  <meta property="og:image" content="${img}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="${u}">
  <link rel="canonical" href="${u}">`;

describe("hasCacheBuster", () => {
  it("mendeteksi param versi dan nama berhash", () => {
    expect(hasCacheBuster(`${BASE}/og.png?v=20260806`)).toBe(true);
    expect(hasCacheBuster(`${BASE}/og.a1b2c3d4e5.png`)).toBe(true);
    expect(hasCacheBuster(`${BASE}/og.png`)).toBe(false);
    expect(hasCacheBuster(`${BASE}/og.png?v=0`)).toBe(false);
  });
});

describe("auditWaPreview", () => {
  const url = `${BASE}/katalog/toko`;

  it("lolos untuk head yang benar", () => {
    const r = auditWaPreview(page(url, goodHead(url)), { url: "x", status: 200, contentType: "image/jpeg", contentLength: 120_000 }, BASE);
    expect(r.issues).toEqual([]);
  });

  it("menandai og:image tanpa cache-buster", () => {
    const r = auditWaPreview(page(url, goodHead(url, `${BASE}/og-brand.png`)), null, BASE);
    expect(r.issues.map((i) => i.id)).toContain("og:image-cache-buster");
  });

  it("menandai og:image relatif dan dimensi hilang", () => {
    const r = auditWaPreview(
      page(url, `<meta property="og:title" content="T"><meta property="og:image" content="/og.png?v=2"><link rel="canonical" href="${url}"><meta property="og:url" content="${url}">`),
      null,
      BASE,
    );
    const ids = r.issues.map((i) => i.id);
    expect(ids).toContain("og:image-absolute");
    expect(ids).toContain("og:image-dimensions");
  });

  it("menandai canonical yang menunjuk halaman lain", () => {
    const r = auditWaPreview(page(url, goodHead(`${BASE}/`)), null, BASE);
    expect(r.issues.map((i) => i.id)).toContain("canonical-self");
  });

  it("menandai gambar yang gagal diambil atau terlalu besar", () => {
    const gagal = auditWaPreview(page(url, goodHead(url)), { url: "x", status: 403 }, BASE);
    expect(gagal.issues.map((i) => i.id)).toContain("og:image-fetch");
    const berat = auditWaPreview(page(url, goodHead(url)), { url: "x", status: 200, contentType: "image/png", contentLength: 8_000_000 }, BASE);
    expect(berat.issues.find((i) => i.id === "og:image-size")?.level).toBe("error");
  });

  it("memberi peringatan rasio yang jauh dari 1.91:1", () => {
    const html = goodHead(url).replace('content="630"', 'content="1200"');
    const r = auditWaPreview(page(url, html), null, BASE);
    expect(r.issues.find((i) => i.id === "og:image-ratio")?.level).toBe("warning");
  });

  it("gagal saat HTTP error", () => {
    const r = auditWaPreview({ url, html: "", status: 500 }, null, BASE);
    expect(r.issues[0].id).toBe("http");
  });
});

describe("auditWaPreviews", () => {
  it("meringkas error dan warning", () => {
    const url = `${BASE}/katalog/toko`;
    const report = auditWaPreviews([page(url, goodHead(url)), page(`${BASE}/harga`, goodHead(`${BASE}/harga`, `${BASE}/og.png`))], {}, BASE);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.id === "og:image-cache-buster")).toBe(true);
  });
});
