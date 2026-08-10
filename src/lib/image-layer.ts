/**
 * Penyiapan foto tambahan (merge photo) untuk PhotoEditor V2.
 *
 * Foto dari kamera HP sekarang lazim 12 MP. Kalau data URL mentahnya
 * ditempel apa adanya ke scene JSON, dua hal jebol sekaligus: JSON
 * autosave membengkak puluhan MB dan Android WebView dibunuh OS saat
 * Konva mengalokasikan buffer seukuran itu. Karena itu setiap foto
 * tambahan diturunkan dulu ke sisi terpanjang ~1600 px sebelum disimpan.
 */

export const IMAGE_LAYER_MAX_DIM = 1600;

export type ImageLayerSource = {
  dataUrl: string;
  width: number;
  height: number;
};

/** Pesan error berbahasa Indonesia — dipakai langsung sebagai toast. */
export class ImageLayerError extends Error {}

/** Skala turun ke dalam kotak `max` tanpa pernah memperbesar. */
export function fitWithin(
  w: number,
  h: number,
  max: number = IMAGE_LAYER_MAX_DIM,
): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const longest = Math.max(w, h);
  if (longest <= max) return { w: Math.round(w), h: Math.round(h) };
  const scale = max / longest;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Validasi murni (tanpa decode) — dites terpisah dari kanvas. */
export function validateImageFile(file: File | null | undefined): { ok: true } | { ok: false; message: string } {
  if (!file) return { ok: false, message: "Tidak ada foto yang dipilih." };
  if (!file.size) return { ok: false, message: "File foto kosong. Coba pilih atau potret ulang." };
  const type = (file.type || "").toLowerCase();
  if (type && !type.startsWith("image/")) {
    return { ok: false, message: "File itu bukan foto. Pilih file gambar (JPG/PNG)." };
  }
  if (type === "image/heic" || type === "image/heif") {
    // Sebagian WebView Android tetap gagal decode HEIC; biarkan dicoba,
    // kegagalan decode akan memunculkan pesan ramah di bawah.
    return { ok: true };
  }
  return { ok: true };
}

/** Format output: pertahankan PNG (transparansi) — sisanya JPEG hemat. */
export function outputMimeFor(file: File): "image/png" | "image/jpeg" {
  return (file.type || "").toLowerCase() === "image/png" ? "image/png" : "image/jpeg";
}

/**
 * Decode + downscale sebuah File menjadi data URL siap simpan.
 * Object URL & elemen gambar sementara selalu dilepas, termasuk saat gagal.
 */
export async function fileToImageLayer(
  file: File,
  max: number = IMAGE_LAYER_MAX_DIM,
): Promise<ImageLayerSource> {
  const check = validateImageFile(file);
  if (!check.ok) throw new ImageLayerError(check.message);

  const url = URL.createObjectURL(file);
  let img: HTMLImageElement | null = null;
  try {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      const onLoad = () => { cleanup(); resolve(el); };
      const onError = () => { cleanup(); reject(new ImageLayerError("Foto tidak bisa dibuka. Coba pilih foto lain.")); };
      const cleanup = () => {
        el.removeEventListener("load", onLoad);
        el.removeEventListener("error", onError);
      };
      el.addEventListener("load", onLoad);
      el.addEventListener("error", onError);
      el.src = url;
    });

    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    if (!(sw > 0) || !(sh > 0)) {
      throw new ImageLayerError("Foto tidak bisa dibuka. Coba pilih foto lain.");
    }
    const { w, h } = fitWithin(sw, sh, max);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageLayerError("Perangkat tidak mendukung penempelan foto.");
    ctx.drawImage(img, 0, 0, w, h);
    const mime = outputMimeFor(file);
    const dataUrl = canvas.toDataURL(mime, mime === "image/jpeg" ? 0.85 : undefined);
    if (!dataUrl || !dataUrl.startsWith("data:image/")) {
      throw new ImageLayerError("Foto gagal diproses. Coba lagi.");
    }
    // Lepas buffer kanvas sesegera mungkin (WebView low-memory).
    canvas.width = 0;
    canvas.height = 0;
    return { dataUrl, width: w, height: h };
  } finally {
    if (img) img.src = "";
    URL.revokeObjectURL(url);
  }
}
