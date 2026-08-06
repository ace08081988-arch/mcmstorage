/**
 * SSOT metadata sosial (Open Graph + Twitter card) untuk halaman publik.
 *
 * Tujuan: nama brand "Ace Storage" selalu terbaca konsisten di pratinjau
 * tautan (WhatsApp, X/Twitter, Facebook, Telegram) — judul selalu bersuffix
 * brand, dan tag `twitter:*` selalu dicerminkan dari `og:*` supaya tidak
 * jatuh ke nilai default root yang generik.
 */
import { withAssetVersion } from "./asset-version";

export const BRAND = "Ace Storage";
export const SITE_URL = "https://mcmstorage.app";
/** Kartu OG default (1200×630) — dipakai bila halaman tak punya gambar sendiri. */
export const DEFAULT_OG_IMAGE = withAssetVersion(`${SITE_URL}/og-ace-storage.png`);
/** Dimensi fisik kartu OG default. */
export const DEFAULT_OG_IMAGE_WIDTH = 1200;
export const DEFAULT_OG_IMAGE_HEIGHT = 630;

/** Tambahkan suffix brand bila judul belum menyebut "Ace Storage"/"Ace Chat". */
export function withBrand(title: string): string {
  return /\bAce (Storage|Chat)\b/i.test(title) ? title : `${title} — ${BRAND}`;
}

type MetaTag = Record<string, string>;

export type SocialMetaInput = {
  title: string;
  description: string;
  /** Path absolut ("/harga") atau URL penuh. */
  url: string;
  type?: "website" | "article" | "product";
  /** URL gambar absolut; default kartu brand Ace Storage. */
  image?: string | null;
  imageAlt?: string;
  /** Dimensi gambar kustom (px). Wajib berpasangan agar tag dipancarkan. */
  imageWidth?: number;
  imageHeight?: number;
  noindex?: boolean;
};

export function absoluteUrl(url: string): string {
  return url.startsWith("http") ? url : `${SITE_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

/**
 * Bangun daftar meta lengkap: title, description, OG, dan Twitter card yang
 * sudah dicerminkan. Selalu pakai `summary_large_image` karena kartu brand
 * maupun foto produk berukuran lebar.
 */
export function socialMeta(input: SocialMetaInput): MetaTag[] {
  const title = withBrand(input.title);
  const url = absoluteUrl(input.url);
  // Gambar milik sendiri diberi cache-buster versi supaya pratinjau
  // WhatsApp/X ikut berubah setelah publish; URL eksternal dibiarkan.
  const image = input.image ? withAssetVersion(absoluteUrl(input.image)) : DEFAULT_OG_IMAGE;
  const alt = input.imageAlt || `${title} — ${BRAND}`;
  // Dimensi: pakai nilai kustom bila lengkap, kalau tidak pakai ukuran kartu
  // default (hanya valid saat gambarnya memang kartu default).
  const dims =
    input.imageWidth && input.imageHeight
      ? { w: input.imageWidth, h: input.imageHeight }
      : input.image
        ? null
        : { w: DEFAULT_OG_IMAGE_WIDTH, h: DEFAULT_OG_IMAGE_HEIGHT };
  const imageType = /\.(jpe?g)(\?|$)/i.test(image)
    ? "image/jpeg"
    : /\.webp(\?|$)/i.test(image)
      ? "image/webp"
      : "image/png";
  return [
    { title },
    { name: "description", content: input.description },
    { property: "og:title", content: title },
    { property: "og:description", content: input.description },
    { property: "og:type", content: input.type ?? "website" },
    { property: "og:url", content: url },
    { property: "og:site_name", content: BRAND },
    { property: "og:locale", content: "id_ID" },
    { property: "og:image", content: image },
    { property: "og:image:secure_url", content: image },
    { property: "og:image:alt", content: alt },
    ...(dims
      ? [
          { property: "og:image:width", content: String(dims.w) },
          { property: "og:image:height", content: String(dims.h) },
        ]
      : []),
    { property: "og:image:type", content: imageType },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: input.description },
    { name: "twitter:image", content: image },
    { name: "twitter:image:alt", content: alt },
    ...(input.noindex ? [{ name: "robots", content: "noindex" }] : []),
  ];
}

/** Link canonical self-referensial untuk leaf route. */
export function canonical(url: string) {
  return { rel: "canonical", href: absoluteUrl(url) };
}
