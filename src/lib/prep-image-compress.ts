// Kompresi/resize otomatis untuk foto yang baru dipilih user sebelum masuk
// PhotoEditor. Tujuan utamanya: menjaga performa Android WebView (RAM & GPU
// terbatas) saat menampilkan thumbnail dan saat PhotoEditor memuat gambar
// ke <canvas>. Kompresi hanya dilakukan bila:
//   • blob adalah image raster yang bisa didecode (bukan GIF/SVG),
//   • ukuran blob melebihi ambang batas (mis. > 400 KB),
//   • lingkungan mendukung `createImageBitmap` + `OffscreenCanvas`
//     (atau `HTMLCanvasElement`) — bila tidak (jsdom/WebView jadul),
//     blob dikembalikan apa adanya tanpa error.
// Kompresi TIDAK boleh melempar error yang mem-blok pipeline: kalau
// gagal, kita fallback ke blob asli agar user tetap bisa mengedit foto.

export type CompressOptions = {
  maxDim?: number;       // sisi terpanjang maksimum, default 2048 px
  quality?: number;      // 0..1 untuk image/jpeg | image/webp, default 0.82
  minBytes?: number;     // di bawah ini foto dianggap sudah kecil, skip
  mimeType?: string;     // output mime, default "image/jpeg"
};

// Format yang TIDAK boleh kita re-encode ke JPEG (animasi/vector hilang).
function isUncompressible(blob: Blob): boolean {
  const t = (blob.type || "").toLowerCase();
  return t === "image/gif" || t === "image/svg+xml" || t === "image/apng";
}

type MinimalCanvas = {
  width: number;
  height: number;
  getContext(id: "2d"): { drawImage: (b: unknown, x: number, y: number, w: number, h: number) => void } | null;
  convertToBlob?: (opts?: { type?: string; quality?: number }) => Promise<Blob>;
  toBlob?: (cb: (b: Blob | null) => void, type?: string, quality?: number) => void;
};

function makeCanvas(w: number, h: number): MinimalCanvas | null {
  const g = globalThis as unknown as {
    OffscreenCanvas?: new (w: number, h: number) => MinimalCanvas;
    document?: { createElement?: (tag: string) => MinimalCanvas };
  };
  if (typeof g.OffscreenCanvas === "function") {
    return new g.OffscreenCanvas(w, h);
  }
  if (g.document?.createElement) {
    const c = g.document.createElement("canvas") as MinimalCanvas;
    if (c && "getContext" in c) {
      c.width = w;
      c.height = h;
      return c;
    }
  }
  return null;
}

async function canvasToBlob(c: MinimalCanvas, type: string, quality: number): Promise<Blob | null> {
  if (typeof c.convertToBlob === "function") {
    try {
      return await c.convertToBlob({ type, quality });
    } catch {
      return null;
    }
  }
  if (typeof c.toBlob === "function") {
    return await new Promise<Blob | null>((res) => c.toBlob!((b) => res(b), type, quality));
  }
  return null;
}

// Hitung dimensi tujuan yang menjaga rasio dan tidak memperbesar foto.
export function fitWithin(w: number, h: number, maxDim: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w, h };
  const longest = Math.max(w, h);
  if (longest <= maxDim) return { w, h };
  const scale = maxDim / longest;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export async function compressImage(
  blob: Blob,
  opts: CompressOptions = {},
): Promise<Blob> {
  const maxDim = opts.maxDim ?? 2048;
  const quality = opts.quality ?? 0.82;
  const minBytes = opts.minBytes ?? 400 * 1024; // 400 KB
  const outType = opts.mimeType ?? "image/jpeg";

  if (isUncompressible(blob)) return blob;
  if (blob.size <= minBytes) return blob;

  const g = globalThis as unknown as {
    createImageBitmap?: (b: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
  };
  if (typeof g.createImageBitmap !== "function") return blob;

  let bitmap: { width: number; height: number; close?: () => void };
  try {
    bitmap = await g.createImageBitmap(blob);
  } catch {
    return blob;
  }
  try {
    const { w, h } = fitWithin(bitmap.width, bitmap.height, maxDim);
    // Jika dimensi sudah kecil dan blob tidak jauh lebih besar dari ambang,
    // re-encode tetap masuk akal karena JPEG quality 0.82 biasanya lebih
    // ramping daripada JPEG kamera default (quality ~0.92).
    const canvas = makeCanvas(w, h);
    if (!canvas) return blob;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out = await canvasToBlob(canvas, outType, quality);
    if (!out || out.size <= 0) return blob;
    // Kalau hasil re-encode ternyata LEBIH BESAR dari asli (foto sudah
    // teroptimasi), pakai blob asli — jangan buang-buang bandwidth.
    if (out.size >= blob.size) return blob;
    return out;
  } catch {
    return blob;
  } finally {
    bitmap.close?.();
  }
}