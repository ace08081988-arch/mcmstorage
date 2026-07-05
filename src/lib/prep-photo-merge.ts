import type { StagedPhoto } from "./prep-file-staging";
import { buildStagedPhoto } from "./prep-file-staging";

/**
 * Gabungkan beberapa StagedPhoto menjadi satu foto komposit.
 *
 * Layout otomatis:
 * - 2 foto  -> 2 kolom x 1 baris
 * - 3–4 foto -> 2 kolom (grid 2x2, sel kosong dibiarkan putih)
 * - 5–9 foto -> 3 kolom
 * - >9 foto -> 3 kolom
 *
 * Setiap foto di-"letterbox" agar tidak terpotong (cover-fit).
 */
export async function mergeStagedPhotos(photos: StagedPhoto[]): Promise<StagedPhoto> {
  if (photos.length === 0) throw new Error("Tidak ada foto untuk digabung");
  if (photos.length === 1) return photos[0];

  const imgs = await Promise.all(
    photos.map(
      (p) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => reject(new Error("Gagal memuat foto untuk gabung"));
          im.src = p.dataUrl;
        }),
    ),
  );

  const n = imgs.length;
  const cols = n === 2 ? 2 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const CELL = 900; // px per sel; hasil akhir ± 1800x1800 untuk 4 foto
  const GAP = 8;
  const width = cols * CELL + (cols + 1) * GAP;
  const height = rows * CELL + (rows + 1) * GAP;

  const cvs = document.createElement("canvas");
  cvs.width = width;
  cvs.height = height;
  const ctx = cvs.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D tidak tersedia");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  imgs.forEach((im, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const cellX = GAP + c * (CELL + GAP);
    const cellY = GAP + r * (CELL + GAP);
    const scale = Math.min(CELL / im.width, CELL / im.height);
    const dw = im.width * scale;
    const dh = im.height * scale;
    const dx = cellX + (CELL - dw) / 2;
    const dy = cellY + (CELL - dh) / 2;
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(cellX, cellY, CELL, CELL);
    ctx.drawImage(im, dx, dy, dw, dh);
  });

  const blob: Blob = await new Promise((resolve, reject) => {
    cvs.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Gagal menyimpan hasil gabung"));
      },
      "image/jpeg",
      0.85,
    );
  });
  const dataUrl = cvs.toDataURL("image/jpeg", 0.85);
  return buildStagedPhoto(dataUrl, blob);
}