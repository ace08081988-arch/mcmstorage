/**
 * Transcoding AVIF di runtime server (Worker).
 *
 * Supabase Storage hanya bisa menegosiasi WebP/JPEG, jadi varian AVIF
 * dibuat sendiri: ambil varian WebP kecil dari Storage, dekode ke piksel
 * mentah, lalu encode ulang ke AVIF dengan codec WASM (jSquash). Modul
 * WASM diimpor sebagai `WebAssembly.Module` supaya ikut ter-bundle —
 * tidak ada resolusi modul saat runtime di Worker.
 */
import decodeWebp, { init as initWebp } from "@jsquash/webp/decode";
import decodeJpeg, { init as initJpeg } from "@jsquash/jpeg/decode";
import decodePng, { init as initPng } from "@jsquash/png/decode";
import encodeAvif, { init as initAvif } from "@jsquash/avif/encode";

import WEBP_DEC_WASM from "@jsquash/webp/codec/dec/webp_dec.wasm";
import JPEG_DEC_WASM from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
import PNG_WASM from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
import AVIF_ENC_WASM from "@jsquash/avif/codec/enc/avif_enc.wasm";

let ready: Promise<void> | null = null;

function initCodecs() {
  ready ??= (async () => {
    await Promise.all([
      initWebp(WEBP_DEC_WASM as WebAssembly.Module),
      initJpeg(JPEG_DEC_WASM as WebAssembly.Module),
      initPng(PNG_WASM as WebAssembly.Module),
      initAvif(AVIF_ENC_WASM as WebAssembly.Module),
    ]);
  })();
  return ready;
}

async function decodeAny(type: string, buf: ArrayBuffer) {
  if (type.includes("webp")) return decodeWebp(buf);
  if (type.includes("png")) return decodePng(buf);
  return decodeJpeg(buf);
}

/** Ubah gambar sumber jadi AVIF. Melempar bila codec gagal. */
export async function transcodeToAvif(
  source: ArrayBuffer,
  contentType: string,
  quality: number,
): Promise<ArrayBuffer> {
  await initCodecs();
  const image = await decodeAny(contentType, source);
  // `speed` 6 adalah kompromi CPU/ukuran yang aman untuk batas waktu Worker.
  return encodeAvif(image, { quality, speed: 6 });
}
