import { describe, it, expect } from "vitest";

import {
  auditRenderedPage,
  auditRenderedPages,
  formatRenderedHeadAudit,
  normalizeUrl,
  parseHead,
  selectAuditUrls,
  urlsFromSitemap,
} from "../rendered-head-audit";

function page(overrides: Partial<Record<string, string>> = {}, url = "/katalog/toko/abc") {
  const m = {
    title: "Beras Premium 5kg — Toko Ace — Ace Storage",
    description: "Beras premium kemasan 5kg, stok tersedia.",
    ogTitle: "Beras Premium 5kg — Toko Ace — Ace Storage",
    ogDescription: "Beras premium kemasan 5kg, stok tersedia.",
    ogImage: "https://mcmstorage.app/og-ace-storage.png?v=20260806",
    ogUrl: "https://mcmstorage.app/katalog/toko/abc",
    twitterCard: "summary_large_image",
    canonical: "https://mcmstorage.app/katalog/toko/abc",
    ...overrides,
  };
  const html = `<html><head>
    <title>${m.title}</title>
    <meta name="description" content="${m.description}">
    <meta property="og:title" content="${m.ogTitle}">
    <meta property="og:description" content="${m.ogDescription}">
    <meta property="og:image" content="${m.ogImage}">
    <meta property="og:url" content="${m.ogUrl}">
    <meta name="twitter:card" content="${m.twitterCard}">
    <link rel="canonical" href="${m.canonical}">
  </head><body></body></html>`;
  return { url, html, status: 200 };
}

describe("parseHead", () => {
  it("membaca title, meta, dan canonical", () => {
    const h = parseHead(page().html);
    expect(h.title).toContain("Beras Premium");
    expect(h.meta["og:image"]).toContain("og-ace-storage.png");
    expect(h.canonical).toBe("https://mcmstorage.app/katalog/toko/abc");
  });
});

describe("audit halaman produk dinamis", () => {
  it("lolos untuk halaman produk yang lengkap", () => {
    expect(auditRenderedPage(page())).toEqual([]);
  });

  it("menolak judul default root yang bocor ke halaman produk", () => {
    const ids = auditRenderedPage(page({ title: "Ace Storage" })).map((i) => i.id);
    expect(ids).toContain("title-generic");
  });

  it("menolak canonical yang menunjuk induk katalog", () => {
    const ids = auditRenderedPage(
      page({ canonical: "https://mcmstorage.app/katalog/toko" }),
    ).map((i) => i.id);
    expect(ids).toContain("canonical-self");
  });

  it("menolak og:image relatif dan og:url yang meleset", () => {
    const ids = auditRenderedPage(
      page({ ogImage: "/foto.png", ogUrl: "https://mcmstorage.app/" }),
    ).map((i) => i.id);
    expect(ids).toContain("og:image-absolute");
    expect(ids).toContain("og:url");
  });

  it("melaporkan status HTTP gagal tanpa memeriksa tag", () => {
    const issues = auditRenderedPage({ url: "/katalog/hilang", html: "", status: 404 });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("http");
  });

  it("melewati kartu sosial pada halaman noindex tapi tetap wajib title", () => {
    const html = `<head><title>Portal</title><meta name="description" content="x"><meta name="robots" content="noindex"></head>`;
    expect(auditRenderedPage({ url: "/t/abc", html, status: 200 })).toEqual([]);
  });

  it("meringkas laporan gabungan", () => {
    const report = auditRenderedPages([page(), page({ canonical: "https://mcmstorage.app/katalog/toko/def", ogUrl: "https://mcmstorage.app/katalog/toko/def" }, "/katalog/toko/def")]);
    expect(report.ok).toBe(true);
    expect(formatRenderedHeadAudit(report)).toBe("Head URL OK — 2 URL diperiksa.");
  });
});

describe("pemilihan URL dari sitemap", () => {
  const xml = `<urlset>
    <url><loc>https://mcmstorage.app/</loc></url>
    <url><loc>https://mcmstorage.app/harga</loc></url>
    <url><loc>https://mcmstorage.app/katalog/toko</loc></url>
    <url><loc>https://mcmstorage.app/katalog/toko/1</loc></url>
    <url><loc>https://mcmstorage.app/katalog/toko/2</loc></url>
    <url><loc>https://mcmstorage.app/katalog/toko/3</loc></url>
    <url><loc>https://mcmstorage.app/katalog/toko/4</loc></url>
  </urlset>`;

  it("mengambil semua loc", () => {
    expect(urlsFromSitemap(xml)).toHaveLength(7);
  });

  it("membatasi contoh per pola dinamis", () => {
    const picked = selectAuditUrls(urlsFromSitemap(xml), { perDynamicPattern: 2 });
    expect(picked).toContain("https://mcmstorage.app/");
    expect(picked).toContain("https://mcmstorage.app/harga");
    expect(picked.filter((u) => /\/katalog\/toko\/\d/.test(u))).toHaveLength(2);
  });
});

describe("normalizeUrl", () => {
  it("menyamakan trailing slash, query, dan host alias", () => {
    expect(normalizeUrl("/harga/")).toBe("https://mcmstorage.app/harga");
    expect(normalizeUrl("https://www.mcmstorage.app/harga?x=1")).toBe(
      "https://mcmstorage.app/harga",
    );
  });
});