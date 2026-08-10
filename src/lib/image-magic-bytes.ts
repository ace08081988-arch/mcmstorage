/**
 * Validasi gambar sisi server berbasis magic byte + dimensi.
 *
 * MIME dari klien tidak dipercaya: file `.jpg` bisa saja skrip, dan PNG
 * kecil bisa mendeklarasikan dimensi raksasa (pixel bomb). Modul ini murni
 * (input `Uint8Array`) supaya bisa dijalankan di worker maupun diuji unit.
 */
export type SniffedImage = {
  mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  width: number | null;
  height: number | null;
};

const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const be32 = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const le16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

function pngSize(b: Uint8Array) {
  return b.length >= 24 ? { width: be32(b, 16), height: be32(b, 20) } : { width: null, height: null };
}

function gifSize(b: Uint8Array) {
  return b.length >= 10 ? { width: le16(b, 6), height: le16(b, 8) } : { width: null, height: null };
}

function jpegSize(b: Uint8Array) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = be16(b, i + 2);
    const isSof =
      (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: be16(b, i + 5), width: be16(b, i + 7) };
    if (len <= 0) break;
    i += 2 + len;
  }
  return { width: null, height: null };
}

function webpSize(b: Uint8Array) {
  if (b.length < 30) return { width: null, height: null };
  const fmt = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (fmt === "VP8X") return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  if (fmt === "VP8L") {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fmt === "VP8 ") return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  return { width: null, height: null };
}

const startsWith = (b: Uint8Array, sig: number[], off = 0) =>
  b.length >= off + sig.length && sig.every((v, i) => b[off + i] === v);

/** Deteksi tipe gambar nyata dari byte awal. `null` = bukan gambar dikenal. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mime: "image/png", ...pngSize(bytes) };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ...jpegSize(bytes) };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { mime: "image/gif", ...gifSize(bytes) };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return { mime: "image/webp", ...webpSize(bytes) };
  return null;
}

export const IMAGE_HARD_MAX_BYTES = 12 * 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 12_000;
export const IMAGE_MAX_PIXELS = 40_000_000; // ~40 MP: cukup untuk kamera HP

export type ImageValidation =
  | { ok: true; mime: SniffedImage["mime"]; width: number | null; height: number | null }
  | { ok: false; reason: "empty" | "too_large" | "not_an_image" | "mime_mismatch" | "dimensions" };

/**
 * Validasi lengkap: ukuran, magic byte, kecocokan dengan MIME klaim klien,
 * dan proteksi pixel bomb.
 */
export function validateImageBytes(
  bytes: Uint8Array,
  opts: { declaredMime?: string | null; maxBytes?: number } = {},
): ImageValidation {
  const maxBytes = opts.maxBytes ?? IMAGE_HARD_MAX_BYTES;
  if (!bytes || bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > maxBytes) return { ok: false, reason: "too_large" };
  const sniffed = sniffImage(bytes);
  if (!sniffed) return { ok: false, reason: "not_an_image" };
  const declared = (opts.declaredMime ?? "").toLowerCase().split(";")[0]?.trim();
  if (declared) {
    const normalized = declared === "image/jpg" ? "image/jpeg" : declared;
    if (normalized !== sniffed.mime) return { ok: false, reason: "mime_mismatch" };
  }
  const { width, height } = sniffed;
  if (width !== null && height !== null) {
    if (width <= 0 || height <= 0) return { ok: false, reason: "dimensions" };
    if (width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION)
      return { ok: false, reason: "dimensions" };
    if (width * height > IMAGE_MAX_PIXELS) return { ok: false, reason: "dimensions" };
  }
  return { ok: true, mime: sniffed.mime, width, height };
}
