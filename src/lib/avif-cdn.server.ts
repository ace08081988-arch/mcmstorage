/**
 * Konfigurasi penyedia AVIF (server-only).
 *
 * Supabase Storage hanya bisa menghasilkan WebP/JPEG, jadi varian AVIF
 * dibuat oleh CDN gambar eksternal yang mengambil (fetch) URL bertanda
 * tangan dari Storage lalu meng-encode ulang + cache di edge miliknya.
 *
 * Aktif bila salah satu env terisi:
 * - `AVIF_CDN_TEMPLATE` — template bebas, placeholder `{url}` (URL sumber,
 *   sudah URL-encoded), `{rawurl}` (tanpa encode), `{w}`, `{q}`.
 * - `CLOUDINARY_CLOUD_NAME` — memakai mode fetch Cloudinary.
 *
 * Bila keduanya kosong, fitur mati total dan halaman tetap memakai WebP.
 */
export function getAvifCdnTemplate(): string | null {
  const custom = process.env["AVIF_CDN_TEMPLATE"];
  if (custom && custom.includes("{")) return custom;
  const cloud = process.env["CLOUDINARY_CLOUD_NAME"];
  if (cloud) {
    return `https://res.cloudinary.com/${cloud}/image/fetch/f_avif,q_{q},w_{w},c_limit/{url}`;
  }
  return null;
}

/** True bila varian AVIF layak ditawarkan ke browser. */
export function isAvifEnabled() {
  return getAvifCdnTemplate() !== null;
}

export function buildAvifCdnUrl(
  template: string,
  sourceUrl: string,
  width: number,
  quality: number,
) {
  return template
    .replaceAll("{url}", encodeURIComponent(sourceUrl))
    .replaceAll("{rawurl}", sourceUrl)
    .replaceAll("{w}", String(width))
    .replaceAll("{q}", String(quality));
}
