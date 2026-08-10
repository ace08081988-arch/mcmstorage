/**
 * OG image katalog publik.
 *
 * Foto produk di Storage hanya bisa diakses lewat URL bertanda tangan yang
 * kedaluwarsa dalam hitungan jam. Crawler WhatsApp/X/Facebook mengambil ulang
 * pratinjau jauh setelah halaman dibuat, jadi URL bertanda tangan itu sudah
 * 403 saat dipakai — pratinjau lalu jatuh ke kartu OG default.
 *
 * Solusinya: og:image menunjuk endpoint stabil milik domain sendiri
 * (`/api/public/img/og`) yang menandatangani ulang berkas saat diminta dan
 * mengalihkan (302) ke varian 1200×630. URL-nya bebas token, jadi bisa
 * di-cache crawler, dan diberi cache-buster `?v=` dari `updated_at` produk
 * supaya pratinjau ikut segar begitu fotonya diganti.
 */

export const CATALOG_OG_ENDPOINT = "/api/public/img/og";
export const CATALOG_OG_WIDTH = 1200;
export const CATALOG_OG_HEIGHT = 630;

export type CatalogOgImage = {
  /** Path absolut di domain sendiri (tanpa query versi). */
  path: string;
  /** Nilai cache-buster (epoch detik dari `updated_at`). */
  version: string;
  type: "image/jpeg" | "image/png" | "image/webp";
};

/** Tebak MIME dari ekstensi berkas Storage; endpoint memakai format asli. */
export function ogImageTypeFromPath(path: string | null | undefined): CatalogOgImage["type"] {
  if (/\.(jpe?g)$/i.test(path ?? "")) return "image/jpeg";
  if (/\.webp$/i.test(path ?? "")) return "image/webp";
  return "image/png";
}

/** Ubah timestamp jadi versi pendek yang stabil. */
export function ogVersionFrom(updatedAt: string | null | undefined): string {
  const t = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(t) ? String(Math.floor(t / 1000)) : "0";
}

export function buildCatalogOgImage(input: {
  slug: string;
  itemId: string;
  imagePath: string | null | undefined;
  updatedAt?: string | null;
}): CatalogOgImage | null {
  if (!input.imagePath) return null;
  const q = new URLSearchParams({ slug: input.slug, item: input.itemId });
  return {
    path: `${CATALOG_OG_ENDPOINT}?${q.toString()}`,
    version: ogVersionFrom(input.updatedAt),
    type: ogImageTypeFromPath(input.imagePath),
  };
}
