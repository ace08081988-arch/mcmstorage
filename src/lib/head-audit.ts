/**
 * Audit otomatis tag head + aset brand (favicon, apple-touch-icon, mask-icon,
 * mstile), manifest PWA, dan kartu OG/Twitter.
 *
 * Modul ini murni (tanpa I/O): pemanggil menyuntikkan isi file lewat
 * `HeadAuditInput` sehingga bisa dipakai dari unit test (fs) maupun dari
 * runtime browser (fetch) tanpa perubahan logika. Hasilnya berupa daftar
 * `issues` yang stabil & terurut supaya cocok untuk snapshot test — mismatch
 * (aset hilang, ukuran salah, warna tile beda, OG/Twitter tak sinkron)
 * langsung terlihat sebelum publish.
 */

import { BRAND_ASSET_VERSION, stripAssetQuery } from "./asset-version";

export type HeadAuditInput = {
  /** Source `src/routes/__root.tsx` (dipakai untuk mengekstrak meta/link). */
  rootSource: string;
  /** Isi `public/manifest.webmanifest`. */
  manifest: string;
  /** Isi `public/browserconfig.xml`. */
  browserconfig: string;
  /** Daftar file yang ada di `public/` (nama file, tanpa folder). */
  publicFiles: string[];
  /** Dimensi gambar per nama file, mis. `{ "icon-512.png": [512, 512] }`. */
  imageSizes?: Record<string, [number, number]>;
};

export type HeadAuditIssue = {
  area: "meta" | "link" | "manifest" | "mstile" | "asset" | "social";
  id: string;
  message: string;
};

export type HeadAuditReport = {
  ok: boolean;
  issues: HeadAuditIssue[];
  /** Ringkasan nilai yang terbaca — berguna untuk snapshot. */
  facts: {
    themeColor: string | null;
    tileColor: string | null;
    maskIconColor: string | null;
    manifestName: string | null;
    manifestIcons: string[];
    ogImageSize: string | null;
    twitterCard: string | null;
  };
};

export const REQUIRED_META = [
  "charSet",
  "viewport",
  "description",
  "theme-color",
  "apple-mobile-web-app-title",
  "apple-mobile-web-app-status-bar-style",
  "msapplication-TileColor",
  "msapplication-config",
  "og:title",
  "og:description",
  "og:type",
  "og:site_name",
  "og:locale",
  "og:image:width",
  "og:image:height",
  "twitter:card",
  "twitter:title",
  "twitter:description",
] as const;

export const REQUIRED_LINKS: { rel: string; href: string }[] = [
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "icon", href: "/favicon.ico" },
  { rel: "icon", href: "/favicon-16.png" },
  { rel: "icon", href: "/favicon-32.png" },
  { rel: "icon", href: "/favicon-48.png" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "mask-icon", href: "/mask-icon.svg" },
];

/** Aset wajib + dimensi yang diharapkan (null = tidak dicek dimensinya). */
export const REQUIRED_ASSETS: { file: string; size: [number, number] | null }[] = [
  { file: "favicon.ico", size: null },
  { file: "favicon-16.png", size: [16, 16] },
  { file: "favicon-32.png", size: [32, 32] },
  { file: "favicon-48.png", size: [48, 48] },
  { file: "apple-touch-icon.png", size: [180, 180] },
  { file: "mask-icon.svg", size: null },
  { file: "icon-192.png", size: [192, 192] },
  { file: "icon-512.png", size: [512, 512] },
  { file: "icon-maskable-512.png", size: [512, 512] },
  { file: "og-ace-storage.png", size: [1200, 630] },
  { file: "mstile-70x70.png", size: [70, 70] },
  { file: "mstile-150x150.png", size: [150, 150] },
  { file: "mstile-310x150.png", size: [310, 150] },
  { file: "mstile-310x310.png", size: [310, 310] },
];

const META_RE = /\{\s*(?:name|property|charSet)\s*:/;

/** Ambil pasangan meta `{ name|property: "x", content: "y" }` dari source. */
export function extractMeta(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (/charSet\s*:\s*"([^"]+)"/.test(source)) {
    out["charSet"] = RegExp.$1;
  }
  const re = /\{\s*(?:name|property)\s*:\s*"([^"]+)"\s*,\s*content\s*:\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (!(m[1] in out)) out[m[1]] = m[2];
  }
  // Meta multi-baris (content di baris berikutnya).
  const reMulti = /\{\s*(?:name|property)\s*:\s*\n?\s*"([^"]+)"\s*,\s*\n\s*content\s*:\s*\n?\s*"([^"]*)"/g;
  while ((m = reMulti.exec(source))) {
    if (!(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

/** Ambil daftar `{ rel, href, sizes?, color? }` dari source. */
export function extractLinks(
  source: string,
): { rel: string; href: string; sizes?: string; color?: string }[] {
  const out: { rel: string; href: string; sizes?: string; color?: string }[] = [];
  const re = /\{\s*rel:\s*"([^"]+)"([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const body = m[2];
    const href = /href:\s*(?:\w+\()?"([^"]+)"/.exec(body)?.[1];
    if (!href) continue;
    out.push({
      rel: m[1],
      href,
      sizes: /sizes:\s*"([^"]+)"/.exec(body)?.[1],
      color: /color:\s*"([^"]+)"/.exec(body)?.[1],
    });
  }
  return out;
}

function tag(xml: string, name: string): string | null {
  return new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(xml)?.[1]?.trim() ?? null;
}

function tileSrc(xml: string, name: string): string | null {
  return new RegExp(`<${name}\\s+src="([^"]+)"`).exec(xml)?.[1] ?? null;
}

export function auditHead(input: HeadAuditInput): HeadAuditReport {
  const issues: HeadAuditIssue[] = [];
  const push = (area: HeadAuditIssue["area"], id: string, message: string) =>
    issues.push({ area, id, message });

  const meta = extractMeta(input.rootSource);
  const links = extractLinks(input.rootSource);
  const files = new Set(input.publicFiles);
  const sizes = input.imageSizes ?? {};

  if (!META_RE.test(input.rootSource)) {
    push("meta", "root-source", "Tidak menemukan blok meta di source root route.");
  }

  for (const key of REQUIRED_META) {
    if (!meta[key]) push("meta", key, `Meta "${key}" hilang di head root.`);
  }

  for (const req of REQUIRED_LINKS) {
    const found = links.find((l) => l.rel === req.rel && l.href === req.href);
    if (!found) push("link", `${req.rel}:${req.href}`, `Link <${req.rel}> ke ${req.href} hilang.`);
  }

  // Aset harus benar-benar ada di public/ dengan dimensi yang benar.
  for (const asset of REQUIRED_ASSETS) {
    if (!files.has(asset.file)) {
      push("asset", asset.file, `Aset public/${asset.file} tidak ditemukan.`);
      continue;
    }
    const actual = sizes[asset.file];
    if (asset.size && actual && (actual[0] !== asset.size[0] || actual[1] !== asset.size[1])) {
      push(
        "asset",
        asset.file,
        `Dimensi ${asset.file} = ${actual[0]}×${actual[1]}, seharusnya ${asset.size[0]}×${asset.size[1]}.`,
      );
    }
  }

  // Semua href lokal di head harus punya file-nya.
  for (const l of links) {
    if (!l.href.startsWith("/")) continue;
    const file = stripAssetQuery(l.href).slice(1);
    if (!files.has(file)) push("link", l.href, `Link <${l.rel}> menunjuk ${l.href} yang tidak ada di public/.`);
  }

  // Manifest
  let manifestName: string | null = null;
  let manifestIcons: string[] = [];
  let manifestThemeColor: string | null = null;
  try {
    const mf = JSON.parse(input.manifest) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      display?: string;
      theme_color?: string;
      background_color?: string;
      icons?: { src: string; sizes: string; purpose?: string }[];
    };
    manifestName = mf.name ?? null;
    manifestThemeColor = mf.theme_color ?? null;
    manifestIcons = (mf.icons ?? []).map((i) => `${i.src} ${i.sizes}${i.purpose ? ` (${i.purpose})` : ""}`);
    for (const field of ["name", "short_name", "start_url", "display", "theme_color", "background_color"] as const) {
      if (!mf[field]) push("manifest", field, `Manifest kehilangan field "${field}".`);
    }
    for (const icon of mf.icons ?? []) {
      const file = stripAssetQuery(icon.src).replace(/^\//, "");
      if (!files.has(file)) {
        push("manifest", icon.src, `Ikon manifest ${icon.src} tidak ada di public/.`);
        continue;
      }
      const actual = sizes[file];
      const declared = icon.sizes.split("x").map(Number);
      if (actual && declared.length === 2 && (actual[0] !== declared[0] || actual[1] !== declared[1])) {
        push(
          "manifest",
          icon.src,
          `Ikon manifest ${icon.src} dideklarasikan ${icon.sizes} tetapi file-nya ${actual[0]}×${actual[1]}.`,
        );
      }
    }
    const has512 = (mf.icons ?? []).some((i) => i.sizes === "512x512");
    const hasMaskable = (mf.icons ?? []).some((i) => (i.purpose ?? "").includes("maskable"));
    if (!has512) push("manifest", "icon-512", "Manifest wajib punya ikon 512×512 untuk prompt install Android.");
    if (!hasMaskable) push("manifest", "maskable", 'Manifest wajib punya ikon dengan purpose "maskable".');
  } catch {
    push("manifest", "parse", "manifest.webmanifest bukan JSON yang valid.");
  }

  if (manifestThemeColor && meta["theme-color"] && manifestThemeColor !== meta["theme-color"]) {
    push(
      "manifest",
      "theme-color",
      `theme_color manifest (${manifestThemeColor}) ≠ meta theme-color (${meta["theme-color"]}).`,
    );
  }

  // mstile / browserconfig
  const tileColor = tag(input.browserconfig, "TileColor");
  const tiles: { tag: string; expect: [number, number] }[] = [
    { tag: "square70x70logo", expect: [70, 70] },
    { tag: "square150x150logo", expect: [150, 150] },
    { tag: "wide310x150logo", expect: [310, 150] },
    { tag: "square310x310logo", expect: [310, 310] },
  ];
  for (const t of tiles) {
    const src = tileSrc(input.browserconfig, t.tag);
    if (!src) {
      push("mstile", t.tag, `browserconfig.xml kehilangan <${t.tag}>.`);
      continue;
    }
    const file = stripAssetQuery(src).replace(/^\//, "");
    if (!files.has(file)) {
      push("mstile", t.tag, `Tile ${src} tidak ada di public/.`);
      continue;
    }
    const actual = sizes[file];
    if (actual && (actual[0] !== t.expect[0] || actual[1] !== t.expect[1])) {
      push("mstile", t.tag, `Tile ${src} berukuran ${actual[0]}×${actual[1]}, seharusnya ${t.expect[0]}×${t.expect[1]}.`);
    }
  }
  if (!tileColor) {
    push("mstile", "TileColor", "browserconfig.xml kehilangan <TileColor>.");
  } else if (meta["msapplication-TileColor"] && tileColor !== meta["msapplication-TileColor"]) {
    push(
      "mstile",
      "TileColor",
      `TileColor browserconfig (${tileColor}) ≠ meta msapplication-TileColor (${meta["msapplication-TileColor"]}).`,
    );
  }

  // OG / Twitter mirroring
  if (meta["og:title"] && meta["twitter:title"] && meta["og:title"] !== meta["twitter:title"]) {
    push("social", "title", "og:title dan twitter:title tidak sama.");
  }
  if (
    meta["og:description"] &&
    meta["twitter:description"] &&
    meta["og:description"] !== meta["twitter:description"]
  ) {
    push("social", "description", "og:description dan twitter:description tidak sama.");
  }
  if (meta["twitter:card"] !== "summary_large_image") {
    push("social", "card", 'twitter:card harus "summary_large_image".');
  }
  if (meta["og:image:width"] !== "1200" || meta["og:image:height"] !== "630") {
    push("social", "og-image-size", "og:image:width/height harus 1200×630.");
  }
  if (meta["og:title"] && !/Ace (Storage|Chat)/.test(meta["og:title"])) {
    push("social", "brand", 'og:title tidak menyebut brand "Ace Storage".');
  }

  issues.sort((a, b) => (a.area + a.id).localeCompare(b.area + b.id));

  return {
    ok: issues.length === 0,
    issues,
    facts: {
      themeColor: meta["theme-color"] ?? null,
      tileColor,
      maskIconColor: links.find((l) => l.rel === "mask-icon")?.color ?? null,
      manifestName,
      manifestIcons,
      ogImageSize:
        meta["og:image:width"] && meta["og:image:height"]
          ? `${meta["og:image:width"]}x${meta["og:image:height"]}`
          : null,
      twitterCard: meta["twitter:card"] ?? null,
    },
  };
}

/** Format laporan jadi teks ringkas (dipakai di pesan gagal test / CLI). */
export function formatHeadAudit(report: HeadAuditReport): string {
  if (report.ok) return "Head audit OK — semua tag, manifest, dan aset sinkron.";
  return report.issues.map((i) => `- [${i.area}] ${i.id}: ${i.message}`).join("\n");
}