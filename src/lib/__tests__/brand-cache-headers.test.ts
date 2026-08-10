import { describe, expect, it } from "vitest";
import {
  BRAND_CACHE_CONTROL,
  auditBrandCacheHeaders,
  isBrandAssetPath,
  isNoCacheValue,
  ogImageUrlsFromHtml,
  withBrandCacheHeaders,
} from "../brand-cache-headers";

const req = (url: string) => new Request(`https://mcmstorage.app${url}`);

describe("isBrandAssetPath", () => {
  it("mengenali aset brand termasuk pola wildcard", () => {
    expect(isBrandAssetPath("/og-ace-storage.png")).toBe(true);
    expect(isBrandAssetPath("/favicon-32x32.png")).toBe(true);
    expect(isBrandAssetPath("/mstile-150x150.png")).toBe(true);
    expect(isBrandAssetPath("/manifest.webmanifest")).toBe(true);
  });
  it("mengabaikan aset build ber-hash", () => {
    expect(isBrandAssetPath("/assets/index-a1b2c3.js")).toBe(false);
    expect(isBrandAssetPath("/nested/favicon.ico")).toBe(false);
  });
});

describe("isNoCacheValue", () => {
  it("menerima no-cache/no-store/max-age=0+must-revalidate", () => {
    expect(isNoCacheValue("no-cache, must-revalidate")).toBe(true);
    expect(isNoCacheValue("no-store")).toBe(true);
    expect(isNoCacheValue("max-age=0, must-revalidate")).toBe(true);
  });
  it("menolak cache panjang atau kosong", () => {
    expect(isNoCacheValue("public, max-age=31536000")).toBe(false);
    expect(isNoCacheValue(null)).toBe(false);
  });
});

describe("withBrandCacheHeaders", () => {
  it("memasang no-cache pada kartu OG", async () => {
    const out = withBrandCacheHeaders(
      req("/og-ace-storage.png?v=20260806"),
      new Response("x", { status: 200, headers: { "content-type": "image/png" } }),
    );
    expect(out.headers.get("cache-control")).toBe(BRAND_CACHE_CONTROL);
    expect(await out.text()).toBe("x");
  });

  it("menormalkan content-type manifest", () => {
    const out = withBrandCacheHeaders(
      req("/manifest.webmanifest"),
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    expect(out.headers.get("content-type")).toBe("application/manifest+json; charset=utf-8");
  });

  it("tidak menyentuh respons halaman biasa", () => {
    const res = new Response("<html>", { status: 200 });
    expect(withBrandCacheHeaders(req("/harga"), res)).toBe(res);
  });

  it("membiarkan respons error apa adanya", () => {
    const res = new Response("nope", { status: 404 });
    expect(withBrandCacheHeaders(req("/favicon.ico"), res)).toBe(res);
  });
});

describe("ogImageUrlsFromHtml", () => {
  it("mengambil og:image dan secure_url dalam urutan atribut apa pun", () => {
    const html = `
      <meta property="og:image" content="https://mcmstorage.app/og-ace-storage.png?v=1">
      <meta content="https://mcmstorage.app/og-ace-storage.png?v=1" property="og:image:secure_url">`;
    expect(ogImageUrlsFromHtml(html)).toEqual([
      "https://mcmstorage.app/og-ace-storage.png?v=1",
    ]);
  });
});

describe("auditBrandCacheHeaders", () => {
  it("lulus saat semua aset no-cache", () => {
    const r = auditBrandCacheHeaders([
      { url: "https://x/og-ace-storage.png", status: 200, cacheControl: "no-cache, must-revalidate", contentType: "image/png" },
    ]);
    expect(r.ok).toBe(true);
  });
  it("melaporkan cache panjang, status gagal, dan content-type manifest salah", () => {
    const r = auditBrandCacheHeaders([
      { url: "https://x/og-ace-storage.png", status: 200, cacheControl: "public, max-age=604800", contentType: "image/png" },
      { url: "https://x/favicon.ico", status: 404, cacheControl: null, contentType: null },
      { url: "https://x/manifest.webmanifest", status: 200, cacheControl: "no-cache", contentType: "text/plain" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.id).sort()).toEqual(["cache-control", "content-type", "unreachable"]);
  });
});
