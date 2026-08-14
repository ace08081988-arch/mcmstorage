// Scene model untuk PhotoEditor V2 (react-konva).
// Serialisasi ke sceneJson agar re-open bisa memulihkan objek editable.

export type SceneId = string;

export type StrokePoint = { x: number; y: number };

export type DrawObj = {
  id: SceneId;
  kind: "draw";
  tool: "pen" | "highlighter" | "brush" | "eraser";
  color: string;
  size: number;
  opacity: number;
  points: number[]; // flat [x,y,x,y,...]
  visible?: boolean;
  locked?: boolean;
};

export type ShapeObj = {
  id: SceneId;
  kind: "shape";
  shape: "arrow" | "line" | "rect" | "circle" | "oval" | "triangle";
  x: number; y: number; width: number; height: number; rotation: number;
  stroke: string; strokeWidth: number; fill?: string; opacity: number;
  visible?: boolean; locked?: boolean;
};

export type TextObj = {
  id: SceneId;
  kind: "text";
  text: string;
  x: number; y: number; width: number; rotation: number;
  color: string; fontSize: number; fontFamily: string;
  bold: boolean; italic: boolean; align: "left" | "center" | "right";
  outline?: string; shadow?: boolean; background?: string;
  opacity: number; visible?: boolean; locked?: boolean;
};

export type StickerObj = {
  id: SceneId;
  kind: "sticker";
  sticker: string; // preset key
  x: number; y: number; width: number; height: number; rotation: number;
  color: string; opacity: number;
  visible?: boolean; locked?: boolean;
};

/**
 * Foto tambahan yang ditempel di atas foto dasar ("merge photo").
 *
 * `src` sengaja disimpan sebagai data URL supaya scene JSON bisa dimuat
 * ulang kapan saja (blob:/object URL mati begitu tab/WebView restart).
 * Ukurannya sudah diturunkan lebih dulu (lihat `src/lib/image-layer.ts`)
 * agar JSON tidak meledak dan Android WebView tidak kehabisan memori.
 *
 * Kind ini bersifat aditif: scene lama yang tidak punya objek `image`
 * tetap valid dan tetap ter-deserialize seperti biasa.
 */
export type ImageObj = {
  id: SceneId;
  kind: "image";
  src: string; // data URL persisten
  x: number; y: number; width: number; height: number; rotation: number;
  opacity: number;
  /** Dimensi natural sumbernya (setelah downscale) — untuk jaga rasio. */
  naturalWidth?: number;
  naturalHeight?: number;
  visible?: boolean; locked?: boolean;
};

export type SceneObject = DrawObj | ShapeObj | TextObj | StickerObj | ImageObj;

export type Scene = {
  version: 1;
  width: number;   // logical canvas size (source image pixels)
  height: number;
  crop?: { x: number; y: number; width: number; height: number } | null;
  rotation?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  objects: SceneObject[];
};

export function emptyScene(width: number, height: number): Scene {
  return { version: 1, width, height, objects: [], rotation: 0, flipH: false, flipV: false, crop: null };
}

export function serializeScene(s: Scene): string {
  return JSON.stringify(s);
}

export function deserializeScene(raw: string | null | undefined, fallback: Scene): Scene {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Scene;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.objects)) return parsed;
  } catch { /* ignore */ }
  return fallback;
}

export function newId(prefix = "o"): SceneId {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Objek yang benar-benar dirender ke stage (dan karenanya ikut ter-ekspor
 * ke JPEG akhir). Layer yang disembunyikan dibuang; layer foto tambahan
 * diperlakukan sama seperti anotasi lain.
 */
export function visibleObjectsForExport(s: Scene): SceneObject[] {
  return s.objects.filter((o) => o.visible !== false);
}