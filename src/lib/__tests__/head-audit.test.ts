import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { auditHead, formatHeadAudit, extractMeta, extractLinks } from "../head-audit";
import { socialMeta, DEFAULT_OG_IMAGE, SITE_URL } from "../seo-meta";
import { BRAND_ASSET_VERSION, stripAssetQuery, withAssetVersion } from "../asset-version";

const root = resolve(__dirname, "../../..");
const publicDir = resolve(root, "public");

/** Baca dimensi PNG dari header IHDR (tanpa dependency image). */
function pngSize(path: string): [number, number] | null {
  const buf = readFileSync(path);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

function collectPublic() {
  const files = readdirSync(publicDir).filter((f) => statSync(resolve(publicDir, f)).isFile());
  const imageSizes: Record<string, [number, number]> = {};
  for (const f of files) {
    if (!f.endsWith(".png")) continue;
    const size = pngSize(resolve(publicDir, f));
    if (size) imageSizes[f] = size;
  }
  return { files, imageSizes };
}

const { files, imageSizes } = collectPublic();
const input = {
  rootSource: readFileSync(resolve(root, "src/routes/__root.tsx"), "utf8"),
  manifest: readFileSync(resolve(publicDir, "manifest.webmanifest"), "utf8"),
  browserconfig: readFileSync(resolve(publicDir, "browserconfig.xml"), "utf8"),
  publicFiles: files,
  imageSizes,
};

describe("audit head + manifest + aset brand", () => {
  it("tidak menemukan mismatch apa pun", () => {
    const report = auditHead(input);
    expect(formatHeadAudit(report)).toBe("Head audit OK — semua tag, manifest, dan aset sinkron.");
    expect(report.ok).toBe(true);
  });

  it("mengunci nilai brand yang terbaca", () => {
    const { facts } = auditHead(input);
    expect(facts.themeColor).toBe("#0a7a4a");
    expect(facts.tileColor).toBe("#0a7a4a");
    expect(facts.maskIconColor).toBe("#c9a227");
    expect(facts.manifestName).toBe("Ace Storage");
    expect(facts.ogImageSize).toBe("1200x630");
    expect(facts.twitterCard).toBe("summary_large_image");
    expect(facts.assetVersion).toBe(BRAND_ASSET_VERSION);
    expect(facts.manifestIcons).toMatchSnapshot();
  });

  it("mendeteksi favicon yang hilang dari public/", () => {
    const report = auditHead({ ...input, publicFiles: files.filter((f) => f !== "favicon-32.png") });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.id.includes("favicon-32.png"))).toBe(true);
  });

  it("mendeteksi dimensi apple-touch-icon yang salah", () => {
    const report = auditHead({
      ...input,
      imageSizes: { ...imageSizes, "apple-touch-icon.png": [120, 120] },
    });
    expect(report.issues.map((i) => i.message)).toContain(
      "Dimensi apple-touch-icon.png = 120×120, seharusnya 180×180.",
    );
  });

  it("mendeteksi TileColor browserconfig yang beda dari meta", () => {
    const report = auditHead({
      ...input,
      browserconfig: input.browserconfig.replace("<TileColor>#0a7a4a</TileColor>", "<TileColor>#123456</TileColor>"),
    });
    expect(report.issues.some((i) => i.area === "mstile" && i.id === "TileColor")).toBe(true);
  });

  it("mendeteksi manifest tanpa ikon 512 / maskable", () => {
    const mf = JSON.parse(input.manifest) as { icons: { sizes: string; purpose?: string }[] };
    mf.icons = mf.icons.filter((i) => i.sizes !== "512x512");
    const report = auditHead({ ...input, manifest: JSON.stringify(mf) });
    expect(report.issues.map((i) => i.id)).toEqual(expect.arrayContaining(["icon-512", "maskable"]));
  });

  it("mendeteksi ikon head tanpa cache-buster versi", () => {
    const report = auditHead({
      ...input,
      rootSource: input.rootSource.replace(
        'withAssetVersion("/apple-touch-icon.png")',
        '"/apple-touch-icon.png"',
      ),
    });
    expect(report.issues.some((i) => i.area === "version" && i.id === "/apple-touch-icon.png")).toBe(true);
  });

  it("mendeteksi ikon manifest tanpa cache-buster versi", () => {
    const report = auditHead({
      ...input,
      manifest: input.manifest.replace(`?v=${BRAND_ASSET_VERSION}`, ""),
    });
    expect(report.issues.some((i) => i.area === "version" && i.id.startsWith("manifest:"))).toBe(true);
  });

  it("mendeteksi tile mstile tanpa cache-buster versi", () => {
    const report = auditHead({
      ...input,
      browserconfig: input.browserconfig.replace(`?v=${BRAND_ASSET_VERSION}`, ""),
    });
    expect(report.issues.some((i) => i.area === "version" && i.id.startsWith("mstile:"))).toBe(true);
  });

  it("mendeteksi mask-icon yang dihapus dari head", () => {
    const report = auditHead({
      ...input,
      rootSource: input.rootSource.replace(/\{ rel: "mask-icon"[^}]*\},?/, ""),
    });
    expect(report.issues.some((i) => i.id === "mask-icon:/mask-icon.svg")).toBe(true);
  });

  it("mendeteksi twitter card yang tidak sinkron dengan og", () => {
    const report = auditHead({
      ...input,
      rootSource: input.rootSource.replace(
        '{ name: "twitter:card", content: "summary_large_image" }',
        '{ name: "twitter:card", content: "summary" }',
      ),
    });
    expect(report.issues.some((i) => i.area === "social" && i.id === "card")).toBe(true);
  });
});

describe("kartu sosial per-rute (socialMeta)", () => {
  const tags = socialMeta({ title: "Katalog Toko", description: "Daftar produk", url: "/katalog/toko" });
  const get = (k: string) => {
    if (k === "title") return tags.find((t) => "title" in t)?.["title"];
    return tags.find((t) => t["name"] === k || t["property"] === k)?.["content"];
  };

  it("mencerminkan og ke twitter dan memakai gambar absolut", () => {
    expect(get("og:title")).toBe(get("twitter:title"));
    expect(get("og:description")).toBe(get("twitter:description"));
    expect(get("og:image")).toBe(get("twitter:image"));
    expect(get("og:image")).toBe(DEFAULT_OG_IMAGE);
    expect(get("og:image")).toBe(`${SITE_URL}/og-ace-storage.png?v=${BRAND_ASSET_VERSION}`);
    expect(get("og:image")!.startsWith("https://")).toBe(true);
    expect(get("og:url")).toBe(`${SITE_URL}/katalog/toko`);
    expect(get("twitter:card")).toBe("summary_large_image");
  });

  it("selalu menambahkan suffix brand pada judul", () => {
    expect(get("title")).toBe("Katalog Toko — Ace Storage");
  });
});

describe("parser head", () => {
  it("membaca meta dan link dari source root", () => {
    const meta = extractMeta(input.rootSource);
    expect(meta["theme-color"]).toMatch(/^#/);
    const links = extractLinks(input.rootSource);
    expect(links.some((l) => l.rel === "manifest" && l.href === "/manifest.webmanifest")).toBe(true);
  });
});

describe("cache-buster aset brand", () => {
  it("menempel versi pada aset lokal & absolut milik sendiri", () => {
    expect(withAssetVersion("/icon-512.png")).toBe(`/icon-512.png?v=${BRAND_ASSET_VERSION}`);
    expect(withAssetVersion(`${SITE_URL}/og-ace-storage.png`)).toBe(
      `${SITE_URL}/og-ace-storage.png?v=${BRAND_ASSET_VERSION}`,
    );
  });

  it("tidak menumpuk versi lama dan tidak menyentuh URL eksternal", () => {
    expect(withAssetVersion("/icon-512.png?v=1999")).toBe(`/icon-512.png?v=${BRAND_ASSET_VERSION}`);
    expect(withAssetVersion("https://cdn.contoh.com/foto.jpg")).toBe("https://cdn.contoh.com/foto.jpg");
    expect(stripAssetQuery("/a.png?v=1#x")).toBe("/a.png");
  });

  it("memakai gambar produk katalog apa adanya bila dari domain lain", () => {
    const tags = socialMeta({
      title: "Produk",
      description: "d",
      url: "/katalog/toko/p",
      image: "https://cdn.contoh.com/produk.jpg",
    });
    expect(tags.find((t) => t["property"] === "og:image")?.["content"]).toBe(
      "https://cdn.contoh.com/produk.jpg",
    );
  });
});
