/**
 * Gerbang unggah gambar: memeriksa isi file (magic byte + dimensi), bukan
 * MIME yang diklaim pemanggil. Dipakai semua jalur unggah foto (prep, ecer,
 * request) supaya file non-gambar yang menyamar sebagai `.jpg`, file
 * kosong/terpotong, dan pixel bomb ditolak sebelum menyentuh storage.
 */
import { validateImageBytes, type ImageValidation } from "./image-magic-bytes";

export const UPLOAD_GUARD_REASON_ID: Record<
  Exclude<ImageValidation, { ok: true }>["reason"],
  string
> = {
  empty: "File kosong atau gagal dibaca.",
  too_large: "Ukuran file melebihi batas unggah.",
  not_an_image: "File bukan gambar yang dikenali (JPEG/PNG/WebP/GIF).",
  mime_mismatch: "Isi file tidak cocok dengan tipe yang dinyatakan.",
  dimensions: "Dimensi gambar tidak wajar (kemungkinan file rusak/berbahaya).",
};

export async function inspectImageBlob(
  blob: Blob,
  opts: { declaredMime?: string | null; maxBytes?: number } = {},
): Promise<ImageValidation> {
  let bytes: Uint8Array;
  try {
    // Cukup 64 KB pertama untuk semua header yang kita pakai.
    const head = blob.slice(0, Math.min(blob.size, 64 * 1024));
    bytes = new Uint8Array(await head.arrayBuffer());
  } catch {
    return { ok: false, reason: "empty" };
  }
  if (opts.maxBytes && blob.size > opts.maxBytes) return { ok: false, reason: "too_large" };
  return validateImageBytes(bytes, {
    declaredMime: opts.declaredMime ?? blob.type ?? null,
    // Batas ukuran sudah diperiksa dari `blob.size` di atas.
    maxBytes: Number.MAX_SAFE_INTEGER,
  });
}

/** `null` bila aman, atau pesan siap tampil bila ditolak. */
export async function rejectionReasonForImage(
  blob: Blob,
  opts: { declaredMime?: string | null; maxBytes?: number } = {},
): Promise<string | null> {
  const res = await inspectImageBlob(blob, opts);
  return res.ok ? null : UPLOAD_GUARD_REASON_ID[res.reason];
}
