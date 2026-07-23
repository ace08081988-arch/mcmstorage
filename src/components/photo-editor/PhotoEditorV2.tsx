/**
 * PhotoEditor V2 — engine react-konva.
 *
 * Iterasi 1: crop preset, rotate/flip, draw (pen/highlighter/brush/eraser),
 * shapes (arrow/line/rect/circle/oval/triangle), text editable, sticker
 * (Lucide-based), layer panel, undo/redo, pinch zoom, autosave scene JSON.
 *
 * API backward-compat:
 *   onSave(blob, dataUrl, sceneJson?)
 *   onCancel()
 *   src, initialSceneJson?, autosaveKey?
 *
 * Testid & label toolbar dipertahankan agar spec e2e lama tetap hijau:
 *   photo-editor-tool-pilih | -coret | -teks | -stiker | -panah | -kotak | -lingkaran
 *   Tombol: "Simpan", "Batal", "Coret", "Kotak", "Lingkaran", "Stiker", "Panah", "Teks", "Pilih"
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type Konva from "konva";
import {
  Stage, Layer, Image as KImage, Line, Rect, Circle, Ellipse, Arrow, Text as KText, Group, Transformer,
} from "react-konva";
import useImage from "use-image";
import {
  Pencil, Type, Sticker, MoveUpRight, Square, Circle as CircleIcon, Undo2, Redo2,
  MousePointer2, Crop, RotateCw, FlipHorizontal2, FlipVertical2, Layers, X, Check,
  AlertTriangle, MapPin, Package, DollarSign, Clock, BadgeCheck, Trash2, Copy, Eye, EyeOff, Lock, Unlock,
  Highlighter, Brush, Eraser, Triangle as TriangleIcon, ZoomIn, ZoomOut, RotateCcw, ChevronLeft,
  ArrowRight, ArrowLeft, ArrowUp, ArrowDown, ArrowUpRight, ArrowUpLeft,
  ArrowLeftRight, CornerUpLeft, CornerUpRight, CornerDownLeft, CornerDownRight,
  MoveRight, MoveLeft, MoveUp, MoveDown, RefreshCw,
  ArrowBigRight, ArrowBigLeft, ChevronsRight, ChevronsLeft, ChevronRight,
  Zap, Heart, Star, ThumbsUp, Flame,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  type Scene, type SceneObject, type DrawObj, type ShapeObj, type TextObj, type StickerObj,
  emptyScene, serializeScene, deserializeScene, newId,
} from "./engine/scene";
import { initHistory, pushHistory, undo as histUndo, redo as histRedo, canUndo, canRedo, readScene } from "./engine/history";
import { useAutosaveScene, loadSceneDraft, clearSceneDraft } from "./hooks/useAutosaveScene";

export type PhotoEditorV2Props = {
  src: string;
  onCancel: () => void;
  onSave: (blob: Blob, dataUrl: string, sceneJson?: string) => void;
  initialSceneJson?: string;
  autosaveKey?: string;
};

type Tool =
  | "pilih" | "coret" | "highlighter" | "brush" | "eraser"
  | "teks" | "stiker" | "panah" | "line" | "kotak" | "lingkaran" | "oval" | "segitiga"
  | "crop";

// Noir & Gold-first palette: emas & krem sebagai aksen brand, disusul warna
// operasional yang tetap dibutuhkan (marker merah/hijau untuk anotasi cepat).
const MCM_PALETTE = [
  "#c9a84c", // gold — brand primary
  "#f0d78c", // gold light
  "#ffffff",
  "#f5f0e0", // cream
  "#ef4444", // merah — flag / hapus
  "#f97316", // oranye
  "#22c55e", // hijau — checklist
  "#06b6d4", // cyan — info
  "#8b5cf6", // ungu
  "#0d0d0d", // noir
];

// Aksen brand — dipakai untuk transformer, ring aktif, save button, dsb.
const GOLD = "#c9a84c";

// Stiker 3D: setiap preset punya warna dasar (untuk radial gradient),
// warna highlight (spot glossy atas), dan glyph unicode yang dirender di
// Konva sebagai centerpiece. Warna dipilih supaya kontras di atas foto
// gelap maupun terang, dengan aksen Noir & Gold untuk kelompok panah.
const STICKER_PRESETS: Record<
  string,
  { label: string; Icon: typeof Check; defaultColor: string; group?: "panah" | "reaksi" | "status" }
> = {
  // ── Panah (arah lengkap) — aksen brand Noir & Gold
  arrow: { label: "Kanan", Icon: ArrowRight, defaultColor: "#c9a84c", group: "panah" },
  "arrow-left": { label: "Kiri", Icon: ArrowLeft, defaultColor: "#c9a84c", group: "panah" },
  "arrow-up": { label: "Atas", Icon: ArrowUp, defaultColor: "#c9a84c", group: "panah" },
  "arrow-down": { label: "Bawah", Icon: ArrowDown, defaultColor: "#c9a84c", group: "panah" },
  "arrow-upright": { label: "Serong", Icon: ArrowUpRight, defaultColor: "#f0d78c", group: "panah" },
  "arrow-upleft": { label: "Balik", Icon: ArrowUpLeft, defaultColor: "#f0d78c", group: "panah" },
  "arrow-both": { label: "Dua Arah", Icon: ArrowLeftRight, defaultColor: "#c9a84c", group: "panah" },
  // ── Panah melengkung (curved)
  "arrow-curve": { label: "Belok Kiri", Icon: CornerUpLeft, defaultColor: "#f0d78c", group: "panah" },
  "arrow-curve-r": { label: "Belok Kanan", Icon: CornerUpRight, defaultColor: "#f0d78c", group: "panah" },
  "arrow-curve-dl": { label: "Turun Kiri", Icon: CornerDownLeft, defaultColor: "#f0d78c", group: "panah" },
  "arrow-curve-dr": { label: "Turun Kanan", Icon: CornerDownRight, defaultColor: "#f0d78c", group: "panah" },
  // ── Panah tebal 3D (bold — stroke lebih tebal dari ArrowRight biasa)
  "arrow-bold-r": { label: "Tebal Kanan", Icon: MoveRight, defaultColor: "#c9a84c", group: "panah" },
  "arrow-bold-l": { label: "Tebal Kiri", Icon: MoveLeft, defaultColor: "#c9a84c", group: "panah" },
  "arrow-bold-u": { label: "Tebal Atas", Icon: MoveUp, defaultColor: "#c9a84c", group: "panah" },
  "arrow-bold-d": { label: "Tebal Bawah", Icon: MoveDown, defaultColor: "#c9a84c", group: "panah" },
  // ── Panah putar (rotate/refresh)
  "arrow-rotate-cw": { label: "Putar Kanan", Icon: RotateCw, defaultColor: "#f0d78c", group: "panah" },
  "arrow-rotate-ccw": { label: "Putar Kiri", Icon: RotateCcw, defaultColor: "#f0d78c", group: "panah" },
  "arrow-refresh": { label: "Refresh", Icon: RefreshCw, defaultColor: "#c9a84c", group: "panah" },
  // ── Panah modern (varian gaya) — semua render vektor tanpa latar
  "arrow-thin-r": { label: "Tipis Kanan", Icon: ChevronRight, defaultColor: "#f0d78c", group: "panah" },
  "arrow-thin-l": { label: "Tipis Kiri", Icon: ChevronLeft, defaultColor: "#f0d78c", group: "panah" },
  "arrow-double-r": { label: "Ganda Kanan", Icon: ChevronsRight, defaultColor: "#c9a84c", group: "panah" },
  "arrow-double-l": { label: "Ganda Kiri", Icon: ChevronsLeft, defaultColor: "#c9a84c", group: "panah" },
  "arrow-block-r": { label: "Blok Kanan", Icon: ArrowBigRight, defaultColor: "#c9a84c", group: "panah" },
  "arrow-block-l": { label: "Blok Kiri", Icon: ArrowBigLeft, defaultColor: "#c9a84c", group: "panah" },
  "arrow-arc-r": { label: "Lengkung Kanan", Icon: Redo2, defaultColor: "#f0d78c", group: "panah" },
  "arrow-arc-l": { label: "Lengkung Kiri", Icon: Undo2, defaultColor: "#f0d78c", group: "panah" },
  "arrow-zigzag-r": { label: "Zigzag", Icon: Zap, defaultColor: "#c9a84c", group: "panah" },
  // ── Status operasional
  check: { label: "Checklist", Icon: Check, defaultColor: "#22c55e", group: "status" },
  x: { label: "Silang", Icon: X, defaultColor: "#ef4444", group: "status" },
  warning: { label: "Warning", Icon: AlertTriangle, defaultColor: "#f59e0b", group: "status" },
  location: { label: "Lokasi", Icon: MapPin, defaultColor: "#3b82f6", group: "status" },
  package: { label: "Paket", Icon: Package, defaultColor: "#8b5cf6", group: "status" },
  paid: { label: "Paid", Icon: DollarSign, defaultColor: "#22c55e", group: "status" },
  pending: { label: "Pending", Icon: Clock, defaultColor: "#eab308", group: "status" },
  verified: { label: "Verified", Icon: BadgeCheck, defaultColor: "#06b6d4", group: "status" },
  // ── Reaksi
  fire: { label: "Api", Icon: Flame, defaultColor: "#f97316", group: "reaksi" },
  bolt: { label: "Kilat", Icon: Zap, defaultColor: "#eab308", group: "reaksi" },
  heart: { label: "Suka", Icon: Heart, defaultColor: "#ef4444", group: "reaksi" },
  star: { label: "Bintang", Icon: Star, defaultColor: "#f0d78c", group: "reaksi" },
  thumb: { label: "Jempol", Icon: ThumbsUp, defaultColor: "#22c55e", group: "reaksi" },
};

// Naikkan/turunkan komponen warna (hex #RRGGBB) sebesar `amount` (-1..1)
// untuk memproduksi highlight & shadow gradient yang konsisten per preset.
function shadeHex(hex: string, amount: number): string {
  const m = /^#?([a-f0-9]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const adj = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c + (amount >= 0 ? 255 - c : c) * amount)));
  const rr = adj(r).toString(16).padStart(2, "0");
  const gg = adj(g).toString(16).padStart(2, "0");
  const bb = adj(b).toString(16).padStart(2, "0");
  return `#${rr}${gg}${bb}`;
}

export function PhotoEditorV2({ src, onCancel, onSave, initialSceneJson, autosaveKey }: PhotoEditorV2Props) {
  // Jangan paksa crossOrigin untuk blob:/data: URL dari kamera/galeri lokal.
  // Android WebView bisa menolak decode diam-diam jika blob lokal diberi CORS.
  const [img, imageLoadStatus] = useImage(src, /^https?:\/\//i.test(src) ? "anonymous" : undefined);
  const [tool, setTool] = useState<Tool>("pilih");
  const [color, setColor] = useState<string>("#ef4444");
  const [strokeWidth, setStrokeWidth] = useState<number>(6);
  const [opacity, setOpacity] = useState<number>(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showLayers, setShowLayers] = useState(false);
  const [showText, setShowText] = useState<null | { id: string }>(null);
  const [showStickers, setShowStickers] = useState(false);
  // 3D sticker style controls — global (berlaku untuk semua stiker & preview
  // sheet). Range 0-100 supaya intuitif di slider; default 100 = tampilan
  // asli. Nilai dipetakan ke opacity/skala offset di renderSticker.
  const [stickerShadow, setStickerShadow] = useState<number>(100);
  const [stickerGloss, setStickerGloss] = useState<number>(100);
  const [stickerRim, setStickerRim] = useState<number>(100);
  // Snap-to-grid (posisi) + snap sudut (rotasi) untuk stiker panah.
  // Default ON supaya penempatan panah rapi sejajar sumbu foto.
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const SNAP_GRID = 8;   // px logika canvas
  const SNAP_ANGLE = 15; // derajat
  const snapToGrid = (v: number) => Math.round(v / SNAP_GRID) * SNAP_GRID;
  const snapToAngle = (deg: number) => Math.round(deg / SNAP_ANGLE) * SNAP_ANGLE;
  // Panel gaya (warna/tebal/opacity) muncul otomatis saat tool coret/bentuk/teks aktif.
  // Panel dapat ditutup manual lewat handle drag di atasnya — state ini menyimpan
  // pilihan pemilik agar tidak "muncul lagi" saat mengganti antar tool goresan.
  const [stylePanelClosed, setStylePanelClosed] = useState(false);

  // Initial scene: prefer initialSceneJson → autosave draft → empty.
  const [scene, setScene] = useState<Scene>(() => emptyScene(0, 0));
  const [history, setHistory] = useState(() => initHistory(emptyScene(0, 0)));
  const initedRef = useRef(false);

  // Once image loaded, initialize scene sized to image.
  useEffect(() => {
    if (!img || initedRef.current) return;
    initedRef.current = true;
    const base = emptyScene(img.naturalWidth || img.width, img.naturalHeight || img.height);
    (async () => {
      let restored: Scene | null = null;
      if (initialSceneJson) restored = deserializeScene(initialSceneJson, base);
      else if (autosaveKey) {
        const draft = await loadSceneDraft(autosaveKey);
        if (draft) restored = deserializeScene(draft, base);
      }
      const s = restored ?? base;
      setScene(s);
      setHistory(initHistory(s));
    })();
  }, [img, initialSceneJson, autosaveKey]);

  // Autosave whenever history.present changes.
  useAutosaveScene(autosaveKey, history.present);

  const commitScene = useCallback((updater: (s: Scene) => Scene) => {
    setScene((prev) => {
      const next = updater(prev);
      setHistory((h) => pushHistory(h, next));
      return next;
    });
  }, []);

  // Fit stage to viewport (mobile 411px). Keep aspect from image.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 411, h: 500 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => {
    const iw = scene.width || img?.width || 1;
    const ih = scene.height || img?.height || 1;
    const s = Math.min(box.w / iw, box.h / ih);
    return { scale: s, w: iw * s, h: ih * s, offsetX: (box.w - iw * s) / 2, offsetY: (box.h - ih * s) / 2 };
  }, [box, scene.width, scene.height, img]);

  // Drawing state
  const drawingRef = useRef<DrawObj | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

  const stagePointerToScene = useCallback((): { x: number; y: number } | null => {
    const st = stageRef.current;
    if (!st) return null;
    const p = st.getPointerPosition();
    if (!p) return null;
    const x = (p.x - fit.offsetX) / (fit.scale * zoom);
    const y = (p.y - fit.offsetY) / (fit.scale * zoom);
    return { x, y };
  }, [fit, zoom]);

  const startPointer = useCallback(() => {
    // Bila ada dua jari (pinch), jangan mulai stroke — pinch handler yang
    // pegang kanvas. Tanpa ini, pinch akan memulai coretan pendek sebelum
    // jari kedua terdeteksi.
    const st = stageRef.current;
    const pointers = st && (st as unknown as { getPointersPositions?: () => Array<{ x: number; y: number }> }).getPointersPositions;
    if (typeof pointers === "function") {
      const list = pointers.call(st);
      if (list && list.length > 1) return;
    }
    const p = stagePointerToScene();
    if (!p) return;
    if (["coret", "highlighter", "brush", "eraser"].includes(tool)) {
      const drawTool = tool === "coret" ? "pen" : (tool as DrawObj["tool"]);
      drawingRef.current = {
        id: newId("d"),
        kind: "draw",
        tool: drawTool,
        color,
        size: tool === "highlighter" ? Math.max(strokeWidth, 14) : strokeWidth,
        opacity: tool === "highlighter" ? Math.min(opacity, 0.5) : opacity,
        points: [p.x, p.y],
      };
      setScene((s) => ({ ...s, objects: [...s.objects, drawingRef.current!] }));
      return;
    }
    // Create shape/arrow/text/sticker on tap
    if (tool === "panah" || tool === "line") {
      const obj: ShapeObj = {
        id: newId("s"), kind: "shape", shape: tool === "panah" ? "arrow" : "line",
        x: p.x, y: p.y, width: 100, height: 0, rotation: 0,
        stroke: color, strokeWidth, opacity,
      };
      commitScene((s) => ({ ...s, objects: [...s.objects, obj] }));
      setSelectedId(obj.id);
      setTool("pilih");
    } else if (tool === "kotak" || tool === "lingkaran" || tool === "oval" || tool === "segitiga") {
      const shape = tool === "kotak" ? "rect" : tool === "lingkaran" ? "circle" : tool === "oval" ? "oval" : "triangle";
      const obj: ShapeObj = {
        id: newId("s"), kind: "shape", shape,
        x: p.x - 60, y: p.y - 60, width: 120, height: 120, rotation: 0,
        stroke: color, strokeWidth, opacity, fill: undefined,
      };
      commitScene((s) => ({ ...s, objects: [...s.objects, obj] }));
      setSelectedId(obj.id);
      setTool("pilih");
    } else if (tool === "teks") {
      const obj: TextObj = {
        id: newId("t"), kind: "text", text: "Ketuk untuk ubah",
        x: p.x - 100, y: p.y - 20, width: 200, rotation: 0,
        color, fontSize: 32, fontFamily: "system-ui, sans-serif",
        bold: false, italic: false, align: "center", opacity: 1,
      };
      commitScene((s) => ({ ...s, objects: [...s.objects, obj] }));
      setSelectedId(obj.id);
      setShowText({ id: obj.id });
      setTool("pilih");
    }
  }, [tool, color, strokeWidth, opacity, stagePointerToScene, commitScene]);

  const movePointer = useCallback(() => {
    if (!drawingRef.current) return;
    const p = stagePointerToScene();
    if (!p) return;
    const d = drawingRef.current;
    d.points = [...d.points, p.x, p.y];
    setScene((s) => ({ ...s, objects: s.objects.map((o) => (o.id === d.id ? { ...d } : o)) }));
  }, [stagePointerToScene]);

  const endPointer = useCallback(() => {
    if (drawingRef.current) {
      const finished = drawingRef.current;
      drawingRef.current = null;
      commitScene((s) => ({ ...s, objects: s.objects.map((o) => (o.id === finished.id ? finished : o)) }));
    }
  }, [commitScene]);

  // Object mutation helpers
  const updateObject = useCallback((id: string, patch: Partial<SceneObject>) => {
    commitScene((s) => ({
      ...s,
      objects: s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as SceneObject) : o)),
    }));
  }, [commitScene]);

  const deleteObject = useCallback((id: string) => {
    commitScene((s) => ({ ...s, objects: s.objects.filter((o) => o.id !== id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, [commitScene]);

  const duplicateObject = useCallback((id: string) => {
    commitScene((s) => {
      const src = s.objects.find((o) => o.id === id);
      if (!src) return s;
      const copy = { ...src, id: newId(src.kind[0]) } as SceneObject;
      if ("x" in copy && "y" in copy) { copy.x = (copy.x as number) + 20; copy.y = (copy.y as number) + 20; }
      return { ...s, objects: [...s.objects, copy] };
    });
  }, [commitScene]);

  const bringForward = useCallback((id: string) => {
    commitScene((s) => {
      const idx = s.objects.findIndex((o) => o.id === id);
      if (idx < 0 || idx === s.objects.length - 1) return s;
      const arr = [...s.objects];
      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
      return { ...s, objects: arr };
    });
  }, [commitScene]);

  const sendBackward = useCallback((id: string) => {
    commitScene((s) => {
      const idx = s.objects.findIndex((o) => o.id === id);
      if (idx <= 0) return s;
      const arr = [...s.objects];
      [arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]];
      return { ...s, objects: arr };
    });
  }, [commitScene]);

  // Undo/redo
  const doUndo = useCallback(() => setHistory((h) => {
    const n = histUndo(h);
    setScene(readScene(n));
    return n;
  }), []);
  const doRedo = useCallback(() => setHistory((h) => {
    const n = histRedo(h);
    setScene(readScene(n));
    return n;
  }), []);

  // Rotate/flip
  const rotate90 = () => commitScene((s) => ({ ...s, rotation: (((s.rotation ?? 0) + 90) % 360) as Scene["rotation"] }));
  const flipH = () => commitScene((s) => ({ ...s, flipH: !s.flipH }));
  const flipV = () => commitScene((s) => ({ ...s, flipV: !s.flipV }));

  // Add sticker
  const addSticker = (key: string) => {
    const preset = STICKER_PRESETS[key];
    if (!preset) return;
    const obj: StickerObj = {
      id: newId("k"), kind: "sticker", sticker: key,
      x: scene.width / 2 - 60, y: scene.height / 2 - 60, width: 120, height: 120, rotation: 0,
      color: preset.defaultColor, opacity: 1,
    };
    commitScene((s) => ({ ...s, objects: [...s.objects, obj] }));
    setSelectedId(obj.id);
    setShowStickers(false);
  };

  // Save: rasterize stage into blob + dataUrl + sceneJson.
  const doSave = useCallback(async () => {
    const st = stageRef.current;
    if (!st) return;
    const prevSel = selectedId;
    setSelectedId(null);
    await new Promise((r) => requestAnimationFrame(r));
    const dataUrl = st.toDataURL({
      pixelRatio: 1,
      mimeType: "image/jpeg",
      quality: 0.9,
      x: fit.offsetX, y: fit.offsetY,
      width: fit.w, height: fit.h,
    });
    setSelectedId(prevSel);
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (autosaveKey) { void clearSceneDraft(autosaveKey); }
    onSave(blob, dataUrl, serializeScene(scene));
  }, [onSave, scene, fit, autosaveKey, selectedId]);

  // Keyboard: Delete removes selected
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        deleteObject(selectedId);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selectedId, deleteObject, doUndo, doRedo]);

  // Pinch zoom + wheel zoom on Stage
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
    setZoom((z) => Math.min(4, Math.max(0.5, z * factor)));
  };

  // Pinch-zoom dua jari yang halus di HP. Ditempel langsung ke elemen container
  // (bukan React onTouch*) supaya `preventDefault` benar-benar berjalan (React
  // memakai listener pasif secara default) — kalau tidak, browser akan
  // menggeser halaman & menimbulkan getar visual saat pinch di atas kanvas.
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let d0 = 0;
    let z0 = 1;
    let active = false;
    const distance = (t: TouchList): number => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.hypot(dx, dy) || 1;
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        d0 = distance(e.touches);
        z0 = zoomRef.current;
        active = true;
        // Buang stroke yang mungkin baru dimulai oleh jari pertama, supaya
        // tidak ada garis tersasar saat jari kedua menyentuh.
        if (drawingRef.current) {
          const finished = drawingRef.current;
          drawingRef.current = null;
          setScene((s) => ({ ...s, objects: s.objects.filter((o) => o.id !== finished.id) }));
        }
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!active || e.touches.length < 2) return;
      e.preventDefault();
      const d = distance(e.touches);
      const next = Math.min(4, Math.max(0.5, (z0 * d) / d0));
      // Snap ke 1× kalau sudah dekat — mencegah tremor saat pemilik "resetting".
      setZoom(Math.abs(next - 1) < 0.04 ? 1 : next);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) active = false;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // Reset penuh — dipakai tombol "Reset" di header. Konfirmasi supaya tidak
  // hilang tak sengaja saat undo/redo panjang.
  const resetAll = useCallback(() => {
    if (typeof window !== "undefined" && !window.confirm("Reset semua editan foto ini?")) return;
    commitScene((s) => ({ ...s, objects: [], rotation: 0, flipH: false, flipV: false, crop: null }));
    setSelectedId(null);
  }, [commitScene]);

  // Tool yang butuh panel gaya (warna + tebal + opacity).
  const needsStyle = ["coret", "highlighter", "brush", "eraser", "panah", "line", "kotak", "lingkaran", "oval", "segitiga", "teks"].includes(tool);

  // Render sticker as Konva group (icon drawn as a filled circle badge with symbol).
  // Iterasi 2 (Noir & Gold): render 3D — radial gradient body, glossy highlight
  // spot di kuadran atas-kiri, shadow drop di bawah, dan ring dalam untuk depth.
  // Warna dasar `o.color` di-shade otomatis (lebih terang untuk highlight,
  // lebih gelap untuk rim) supaya konsisten di semua palet.
  const renderSticker = (o: StickerObj) => {
    if (o.visible === false) return null;
    const r = o.width / 2;
    const cx = o.width / 2;
    const cy = o.height / 2;
    const base = o.color;
    const light = shadeHex(base, 0.55); // highlight atas — lebih pucat
    const dark = shadeHex(base, -0.35); // rim bawah — lebih gelap
    const rim = shadeHex(base, -0.55); // outline dalam
    // Faktor 0..1 dari slider global. 0 = fitur mati, 1 = intensitas penuh.
    const shF = stickerShadow / 100;
    const glF = stickerGloss / 100;
    const rmF = stickerRim / 100;
    const preset = STICKER_PRESETS[o.sticker];
    const isArrow = preset?.group === "panah";
    // ── Arrow modern: tanpa latar bulat, murni vector (untuk arah lurus/serong/bold)
    //    atau glyph berwarna tanpa badge (untuk lengkung/putar). Ini yang diminta
    //    user — panah "clean" seperti stiker WA modern, bukan medali bulat.
    if (isArrow) {
      const vectorKeys = new Set([
        "arrow","arrow-left","arrow-up","arrow-down",
        "arrow-upright","arrow-upleft","arrow-both",
        "arrow-bold-r","arrow-bold-l","arrow-bold-u","arrow-bold-d",
        "arrow-thin-r","arrow-thin-l",
      ]);
      const modernKeys = new Set([
        "arrow-double-r","arrow-double-l",
        "arrow-block-r","arrow-block-l",
        "arrow-arc-r","arrow-arc-l",
        "arrow-zigzag-r",
      ]);
      const commonWrap = {
        key: o.id,
        id: o.id,
        x: o.x, y: o.y, rotation: o.rotation, opacity: o.opacity,
        draggable: tool === "pilih" && !o.locked,
        onClick: () => setSelectedId(o.id),
        onTap: () => setSelectedId(o.id),
        dragBoundFunc: snapEnabled
          ? (pos: { x: number; y: number }) => ({ x: snapToGrid(pos.x), y: snapToGrid(pos.y) })
          : undefined,
        onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
          const nx = snapEnabled ? snapToGrid(e.target.x()) : e.target.x();
          const ny = snapEnabled ? snapToGrid(e.target.y()) : e.target.y();
          updateObject(o.id, { x: nx, y: ny });
        },
        onTransform: (e: Konva.KonvaEventObject<Event>) => {
          // Snap sudut live saat memutar via handle rotator.
          if (!snapEnabled) return;
          const n = e.target as unknown as Konva.Node;
          const snapped = snapToAngle(n.rotation());
          if (n.rotation() !== snapped) n.rotation(snapped);
        },
        onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
          const n = e.target as unknown as Konva.Node;
          const sx = n.scaleX(), sy = n.scaleY();
          const rot = snapEnabled ? snapToAngle(n.rotation()) : n.rotation();
          const nx = snapEnabled ? snapToGrid(n.x()) : n.x();
          const ny = snapEnabled ? snapToGrid(n.y()) : n.y();
          updateObject(o.id, {
            x: nx, y: ny,
            width: Math.max(24, o.width * sx),
            height: Math.max(24, o.height * sy),
            rotation: rot,
          });
          n.scaleX(1); n.scaleY(1);
        },
      } as const;
      if (vectorKeys.has(o.sticker)) {
        const w = o.width, h = o.height;
        const bold = o.sticker.startsWith("arrow-bold-");
        const thin = o.sticker.startsWith("arrow-thin-");
        // titik pangkal → ujung (padding 8% supaya arrowhead tidak terpotong)
        let points: number[];
        switch (o.sticker) {
          case "arrow": case "arrow-bold-r": points = [w * 0.08, h / 2, w * 0.92, h / 2]; break;
          case "arrow-left": case "arrow-bold-l": points = [w * 0.92, h / 2, w * 0.08, h / 2]; break;
          case "arrow-up": case "arrow-bold-u": points = [w / 2, h * 0.92, w / 2, h * 0.08]; break;
          case "arrow-down": case "arrow-bold-d": points = [w / 2, h * 0.08, w / 2, h * 0.92]; break;
          case "arrow-upright": points = [w * 0.08, h * 0.92, w * 0.92, h * 0.08]; break;
          case "arrow-upleft": points = [w * 0.92, h * 0.92, w * 0.08, h * 0.08]; break;
          case "arrow-both": points = [w * 0.12, h / 2, w * 0.88, h / 2]; break;
          case "arrow-thin-r": points = [w * 0.08, h / 2, w * 0.92, h / 2]; break;
          case "arrow-thin-l": points = [w * 0.92, h / 2, w * 0.08, h / 2]; break;
          default: points = [w * 0.08, h / 2, w * 0.92, h / 2];
        }
        const sw = bold ? Math.max(8, r * 0.32) : thin ? Math.max(2, r * 0.08) : Math.max(5, r * 0.18);
        const ptr = bold ? Math.max(20, r * 0.7) : thin ? Math.max(10, r * 0.3) : Math.max(16, r * 0.5);
        return (
          <Group {...commonWrap}>
            <Arrow
              points={points}
              stroke={o.color}
              fill={o.color}
              strokeWidth={sw}
              pointerLength={ptr}
              pointerWidth={ptr}
              pointerAtBeginning={o.sticker === "arrow-both"}
              lineCap="round"
              lineJoin="round"
              shadowColor={`rgba(0,0,0,${0.55 * shF})`}
              shadowBlur={r * 0.18 * shF}
              shadowOffsetY={r * 0.08 * shF}
              listening
            />
          </Group>
        );
      }
      if (modernKeys.has(o.sticker)) {
        const w = o.width, h = o.height;
        const sw = Math.max(5, r * 0.18);
        const ptr = Math.max(16, r * 0.5);
        const shadow = {
          shadowColor: `rgba(0,0,0,${0.55 * shF})`,
          shadowBlur: r * 0.18 * shF,
          shadowOffsetY: r * 0.08 * shF,
        } as const;
        // Double-line arrow: dua batang paralel dengan satu arrowhead di ujung.
        if (o.sticker === "arrow-double-r" || o.sticker === "arrow-double-l") {
          const rev = o.sticker === "arrow-double-l";
          const x0 = rev ? w * 0.92 : w * 0.08;
          const x1 = rev ? w * 0.08 : w * 0.92;
          const gap = Math.max(4, r * 0.18);
          const sw2 = Math.max(3, r * 0.12);
          return (
            <Group {...commonWrap}>
              <Arrow points={[x0, h / 2 - gap, x1, h / 2 - gap]} stroke={o.color} fill={o.color}
                strokeWidth={sw2} pointerLength={ptr * 0.85} pointerWidth={ptr * 0.85}
                lineCap="round" lineJoin="round" {...shadow} listening />
              <Arrow points={[x0, h / 2 + gap, x1, h / 2 + gap]} stroke={o.color} fill={o.color}
                strokeWidth={sw2} pointerLength={ptr * 0.85} pointerWidth={ptr * 0.85}
                lineCap="round" lineJoin="round" {...shadow} listening />
            </Group>
          );
        }
        // Block arrow: poligon padat berbentuk anak panah tebal.
        if (o.sticker === "arrow-block-r" || o.sticker === "arrow-block-l") {
          const rev = o.sticker === "arrow-block-l";
          const tailH = h * 0.28;
          const headH = h * 0.72;
          const headW = w * 0.42;
          const y1 = (h - tailH) / 2;
          const y2 = y1 + tailH;
          const yh1 = (h - headH) / 2;
          const yh2 = yh1 + headH;
          const xTailStart = rev ? w * 0.95 : w * 0.05;
          const xNeck = rev ? headW : w - headW;
          const xTip = rev ? w * 0.05 : w * 0.95;
          const pts = rev
            ? [xTailStart, y1, xNeck, y1, xNeck, yh1, xTip, h / 2, xNeck, yh2, xNeck, y2, xTailStart, y2]
            : [xTailStart, y1, xNeck, y1, xNeck, yh1, xTip, h / 2, xNeck, yh2, xNeck, y2, xTailStart, y2];
          return (
            <Group {...commonWrap}>
              <Line points={pts} closed fill={o.color} stroke={o.color} strokeWidth={1}
                lineJoin="round" {...shadow} listening />
            </Group>
          );
        }
        // Arc arrow: kurva quadratic dengan arrowhead (pakai tension Konva).
        if (o.sticker === "arrow-arc-r" || o.sticker === "arrow-arc-l") {
          const rev = o.sticker === "arrow-arc-l";
          const p = rev
            ? [w * 0.92, h * 0.85, w * 0.5, h * 0.15, w * 0.08, h * 0.85]
            : [w * 0.08, h * 0.85, w * 0.5, h * 0.15, w * 0.92, h * 0.85];
          return (
            <Group {...commonWrap}>
              <Arrow points={p} tension={0.5} stroke={o.color} fill={o.color}
                strokeWidth={sw} pointerLength={ptr} pointerWidth={ptr}
                lineCap="round" lineJoin="round" {...shadow} listening />
            </Group>
          );
        }
        // Zigzag arrow: polyline patah-patah + arrowhead di ujung kanan.
        if (o.sticker === "arrow-zigzag-r") {
          const p = [
            w * 0.08, h * 0.5,
            w * 0.32, h * 0.2,
            w * 0.55, h * 0.78,
            w * 0.92, h * 0.35,
          ];
          return (
            <Group {...commonWrap}>
              <Arrow points={p} stroke={o.color} fill={o.color}
                strokeWidth={sw} pointerLength={ptr} pointerWidth={ptr}
                lineCap="round" lineJoin="round" {...shadow} listening />
            </Group>
          );
        }
      }
      // Lengkung / putar / refresh → glyph unicode berwarna (tanpa badge)
      return (
        <Group {...commonWrap}>
          <KText
            x={0}
            y={cy - r * 0.95}
            width={o.width}
            align="center"
            text={stickerGlyph(o.sticker)}
            fontSize={r * 1.8}
            fontStyle="bold"
            fill={o.color}
            shadowColor={`rgba(0,0,0,${0.5 * shF})`}
            shadowBlur={r * 0.18 * shF}
            shadowOffsetY={r * 0.07 * shF}
            listening
          />
        </Group>
      );
    }
    return (
      <Group
        key={o.id}
        id={o.id}
        x={o.x}
        y={o.y}
        rotation={o.rotation}
        opacity={o.opacity}
        draggable={tool === "pilih" && !o.locked}
        onClick={() => setSelectedId(o.id)}
        onTap={() => setSelectedId(o.id)}
        onDragEnd={(e) => updateObject(o.id, { x: e.target.x(), y: e.target.y() })}
        onTransformEnd={(e) => {
          const n = e.target as unknown as Konva.Node;
          const sx = n.scaleX(), sy = n.scaleY();
          updateObject(o.id, {
            x: n.x(), y: n.y(),
            width: Math.max(20, o.width * sx),
            height: Math.max(20, o.height * sy),
            rotation: n.rotation(),
          });
          n.scaleX(1); n.scaleY(1);
        }}
      >
        {/* 1. Drop shadow (lapisan bawah): circle full berwarna hitam,
               digeser sedikit ke bawah supaya sticker tampak "melayang". */}
        <Circle
          x={cx}
          y={cy + r * 0.06}
          radius={r * 0.98}
          fill={`rgba(0,0,0,${0.35 * shF})`}
          shadowColor={`rgba(0,0,0,${0.5 * shF})`}
          shadowBlur={r * 0.35 * shF}
          shadowOffsetY={r * 0.12 * shF}
          listening={false}
        />
        {/* 2. Body dengan radial gradient (light di kuadran atas-kiri → dark di rim). */}
        <Circle
          x={cx}
          y={cy}
          radius={r}
          fillRadialGradientStartPoint={{ x: -r * 0.35, y: -r * 0.35 }}
          fillRadialGradientStartRadius={0}
          fillRadialGradientEndPoint={{ x: 0, y: 0 }}
          fillRadialGradientEndRadius={r}
          fillRadialGradientColorStops={[0, light, 0.55, base, 1, dark]}
          stroke={rim}
          strokeWidth={Math.max(0, r * 0.04 * rmF)}
        />
        {/* 3. Rim inner ring untuk memperkuat kesan tebal / bezel. */}
        <Circle
          x={cx}
          y={cy}
          radius={r * 0.92}
          stroke={`rgba(255,255,255,${0.18 * rmF})`}
          strokeWidth={Math.max(0, r * 0.03 * rmF)}
          listening={false}
        />
        {/* 4. Glossy highlight — ellipse putih transparan di kuadran atas. */}
        <Ellipse
          x={cx - r * 0.22}
          y={cy - r * 0.42}
          radiusX={r * 0.55}
          radiusY={r * 0.28}
          fillLinearGradientStartPoint={{ x: 0, y: -r * 0.28 }}
          fillLinearGradientEndPoint={{ x: 0, y: r * 0.28 }}
          fillLinearGradientColorStops={[0, `rgba(255,255,255,${0.85 * glF})`, 1, "rgba(255,255,255,0)"]}
          listening={false}
        />
        {/* 5. Glyph — putih dengan drop shadow tipis supaya "punch" di atas body. */}
        <KText
          x={0}
          y={cy - r * 0.5}
          width={o.width}
          align="center"
          text={stickerGlyph(o.sticker)}
          fontSize={r}
          fontStyle="bold"
          fill="#ffffff"
          shadowColor="rgba(0,0,0,0.45)"
          shadowBlur={r * 0.12}
          shadowOffsetY={r * 0.06}
          listening={false}
        />
      </Group>
    );
  };

  const renderShape = (o: ShapeObj) => {
    if (o.visible === false) return null;
    const common = {
      id: o.id,
      x: o.x, y: o.y, rotation: o.rotation, opacity: o.opacity,
      draggable: tool === "pilih" && !o.locked,
      onClick: () => setSelectedId(o.id),
      onTap: () => setSelectedId(o.id),
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => updateObject(o.id, { x: e.target.x(), y: e.target.y() }),
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
        const n = e.target as unknown as Konva.Node;
        const sx = n.scaleX(), sy = n.scaleY();
        updateObject(o.id, {
          x: n.x(), y: n.y(),
          width: Math.max(4, o.width * sx),
          height: Math.max(4, o.height * sy),
          rotation: n.rotation(),
        });
        n.scaleX(1); n.scaleY(1);
      },
      stroke: o.stroke, strokeWidth: o.strokeWidth, fill: o.fill,
    } as const;
    if (o.shape === "rect") return <Rect key={o.id} {...common} width={o.width} height={o.height} />;
    if (o.shape === "circle") return <Ellipse key={o.id} {...common} radiusX={o.width / 2} radiusY={o.width / 2} x={o.x + o.width / 2} y={o.y + o.width / 2} />;
    if (o.shape === "oval") return <Ellipse key={o.id} {...common} radiusX={o.width / 2} radiusY={o.height / 2} x={o.x + o.width / 2} y={o.y + o.height / 2} />;
    if (o.shape === "triangle") {
      const pts = [o.width / 2, 0, o.width, o.height, 0, o.height];
      return <Line key={o.id} {...common} points={pts} closed />;
    }
    if (o.shape === "arrow") return <Arrow key={o.id} {...common} points={[0, 0, o.width, o.height]} pointerLength={16} pointerWidth={16} />;
    if (o.shape === "line") return <Line key={o.id} {...common} points={[0, 0, o.width, o.height]} />;
    return null;
  };

  const renderText = (o: TextObj) => {
    if (o.visible === false) return null;
    return (
      <KText
        key={o.id}
        id={o.id}
        x={o.x} y={o.y} width={o.width}
        rotation={o.rotation} opacity={o.opacity}
        text={o.text}
        fontSize={o.fontSize}
        fontFamily={o.fontFamily}
        fontStyle={`${o.italic ? "italic" : ""} ${o.bold ? "bold" : ""}`.trim() || "normal"}
        align={o.align}
        fill={o.color}
        stroke={o.outline}
        strokeWidth={o.outline ? 2 : 0}
        shadowColor={o.shadow ? "#000" : undefined}
        shadowBlur={o.shadow ? 6 : 0}
        shadowOpacity={o.shadow ? 0.6 : 0}
        draggable={tool === "pilih" && !o.locked}
        onClick={() => setSelectedId(o.id)}
        onTap={() => setSelectedId(o.id)}
        onDblClick={() => setShowText({ id: o.id })}
        onDblTap={() => setShowText({ id: o.id })}
        onDragEnd={(e) => updateObject(o.id, { x: e.target.x(), y: e.target.y() })}
        onTransformEnd={(e) => {
          const n = e.target as unknown as Konva.Node;
          const sx = n.scaleX();
          updateObject(o.id, {
            x: n.x(), y: n.y(),
            width: Math.max(40, o.width * sx),
            rotation: n.rotation(),
            fontSize: Math.max(10, o.fontSize * sx),
          });
          n.scaleX(1); n.scaleY(1);
        }}
      />
    );
  };

  const renderDraw = (o: DrawObj) => {
    if (o.visible === false) return null;
    return (
      <Line
        key={o.id}
        id={o.id}
        points={o.points}
        stroke={o.color}
        strokeWidth={o.size}
        opacity={o.opacity}
        lineCap="round"
        lineJoin="round"
        tension={0.4}
        globalCompositeOperation={o.tool === "eraser" ? "destination-out" : o.tool === "highlighter" ? "multiply" : "source-over"}
      />
    );
  };

  // Transformer for selected non-draw object
  const transformerRef = useRef<Konva.Transformer | null>(null);
  useEffect(() => {
    const st = stageRef.current;
    const tr = transformerRef.current;
    if (!st || !tr) return;
    if (!selectedId) { tr.nodes([]); tr.getLayer()?.batchDraw(); return; }
    const node = st.findOne("#" + selectedId);
    if (node) tr.nodes([node as Konva.Node]);
    else tr.nodes([]);
    // Stiker & teks lebih nyaman kalau proporsional (keepRatio) supaya
    // saat drag sudut ukuran tidak melar. Sisanya bebas.
    const sel = scene.objects.find((o) => o.id === selectedId);
    const lockRatio = sel?.kind === "sticker" || sel?.kind === "text";
    tr.keepRatio(lockRatio);
    tr.enabledAnchors(
      lockRatio
        ? ["top-left", "top-right", "bottom-left", "bottom-right"]
        : ["top-left","top-center","top-right","middle-right","bottom-right","bottom-center","bottom-left","middle-left"],
    );
    tr.getLayer()?.batchDraw();
  }, [selectedId, scene.objects]);

  const selectedObj = scene.objects.find((o) => o.id === selectedId) ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col text-foreground"
      style={{
        background:
          "radial-gradient(120% 80% at 50% 0%, #1a1a1a 0%, #0d0d0d 55%, #050505 100%)",
      }}
      data-testid="photo-editor-v2"
    >
      {/* Canvas — full bleed. Chrome (header, pill toolbar, panel) melayang di atasnya
          agar foto punya ruang maksimum di HP 411px. */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden touch-none">
        <Stage
          ref={stageRef}
          width={box.w}
          height={box.h}
          onMouseDown={startPointer}
          onMouseMove={movePointer}
          onMouseUp={endPointer}
          onTouchStart={startPointer}
          onTouchMove={movePointer}
          onTouchEnd={endPointer}
          onWheel={onWheel}
        >
          <Layer
            x={fit.offsetX} y={fit.offsetY}
            scaleX={fit.scale * zoom * (scene.flipH ? -1 : 1)}
            scaleY={fit.scale * zoom * (scene.flipV ? -1 : 1)}
            offsetX={scene.flipH ? scene.width : 0}
            offsetY={scene.flipV ? scene.height : 0}
            rotation={scene.rotation ?? 0}
          >
            {img && <KImage image={img} width={scene.width} height={scene.height} listening={false} />}
            {scene.objects.map((o) => {
              if (o.kind === "draw") return renderDraw(o);
              if (o.kind === "shape") return renderShape(o);
              if (o.kind === "text") return renderText(o);
              if (o.kind === "sticker") return renderSticker(o);
              return null;
            })}
            <Transformer
              ref={(n) => { transformerRef.current = n; }}
              rotateEnabled
              anchorSize={22}
              anchorCornerRadius={11}
              rotateAnchorOffset={28}
              borderStroke={GOLD}
              anchorStroke={GOLD}
              anchorFill="#0d0d0d"
              rotationSnaps={
                snapEnabled && selectedObj?.kind === "sticker" &&
                STICKER_PRESETS[(selectedObj as StickerObj).sticker]?.group === "panah"
                  ? [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180,
                     -15, -30, -45, -60, -75, -90, -105, -120, -135, -150, -165]
                  : []
              }
              rotationSnapTolerance={snapEnabled ? 8 : 0}
            />
          </Layer>
        </Stage>

        {!img && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-ms-6 text-center">
            <div className="rounded-lg border border-[#c9a84c]/20 bg-[#0d0d0d]/80 px-ms-4 py-ms-3 text-ms-sm text-[#f0d78c] shadow-xl backdrop-blur-xl">
              {imageLoadStatus === "failed"
                ? "Foto tidak bisa dibuka di editor. Tekan Batal lalu pilih ulang."
                : "Membuka foto…"}
            </div>
          </div>
        )}

        {/* Header glass — kiri (batal + reset), tengah (title kosong), kanan (undo/redo/layer/simpan). */}
        <header
          className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-ms-2 px-ms-2 py-ms-2"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)" }}
        >
          <div className="pointer-events-auto flex items-center gap-ms-1 rounded-full border border-[#c9a84c]/15 bg-[#0d0d0d]/70 px-ms-1 py-ms-1 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.9)] backdrop-blur-xl">
            <IconPill onClick={onCancel} label="Batal"><ChevronLeft className="h-5 w-5" /></IconPill>
            <IconPill onClick={resetAll} label="Reset semua editan"><RotateCcw className="h-5 w-5" /></IconPill>
          </div>
          <div className="pointer-events-auto flex items-center gap-ms-1 rounded-full border border-[#c9a84c]/15 bg-[#0d0d0d]/70 px-ms-1 py-ms-1 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.9)] backdrop-blur-xl">
            <IconPill onClick={doUndo} disabled={!canUndo(history)} label="Undo"><Undo2 className="h-5 w-5" /></IconPill>
            <IconPill onClick={doRedo} disabled={!canRedo(history)} label="Redo"><Redo2 className="h-5 w-5" /></IconPill>
            <IconPill onClick={() => setShowLayers((v) => !v)} label="Layer" active={showLayers}><Layers className="h-5 w-5" /></IconPill>
            <Button
              size="sm"
              onClick={doSave}
              className="ml-ms-1 h-9 rounded-full border border-[#c9a84c]/50 px-ms-4 text-ms-sm font-semibold text-[#0d0d0d] shadow-[0_6px_20px_-6px_rgba(201,168,76,0.55)] hover:brightness-105"
              style={{ background: "linear-gradient(180deg, #f0d78c 0%, #c9a84c 55%, #a3873a 100%)" }}
            >
              Simpan
            </Button>
          </div>
        </header>

        {/* Kolom kiri-tengah: transform (rotate/flip). Vertikal supaya tidak menutupi foto. */}
        <div
          className="pointer-events-none absolute left-ms-2 top-1/2 z-20 -translate-y-1/2"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="pointer-events-auto flex flex-col gap-ms-1 rounded-full border border-[#c9a84c]/15 bg-[#0d0d0d]/60 p-ms-1 backdrop-blur-xl">
            <IconPill onClick={rotate90} label="Putar 90°"><RotateCw className="h-5 w-5" /></IconPill>
            <IconPill onClick={flipH} label="Flip horizontal" active={!!scene.flipH}><FlipHorizontal2 className="h-5 w-5" /></IconPill>
            <IconPill onClick={flipV} label="Flip vertikal" active={!!scene.flipV}><FlipVertical2 className="h-5 w-5" /></IconPill>
            <IconPill onClick={() => setTool("crop")} disabled label="Crop (segera)"><Crop className="h-5 w-5" /></IconPill>
          </div>
        </div>

        {/* Kanan-tengah: zoom badge vertikal. */}
        <div className="pointer-events-none absolute right-ms-2 top-1/2 z-20 -translate-y-1/2">
          <div className="pointer-events-auto flex flex-col items-center gap-ms-1 rounded-full border border-[#c9a84c]/15 bg-[#0d0d0d]/60 p-ms-1 backdrop-blur-xl">
            <IconPill onClick={() => setZoom((z) => Math.min(4, z + 0.25))} label="Zoom in"><ZoomIn className="h-5 w-5" /></IconPill>
            <span className="min-w-10 text-center text-ms-2xs font-medium tabular-nums text-[#f0d78c]/85">{Math.round(zoom * 100)}%</span>
            <IconPill onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} label="Zoom out"><ZoomOut className="h-5 w-5" /></IconPill>
          </div>
        </div>

        {/* Object action bar (when selected) — dipindah ke bawah header. */}
        {selectedObj && (
          <div
            className="pointer-events-auto absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-ms-1 rounded-full border border-[#c9a84c]/25 bg-[#0d0d0d]/80 px-ms-1 py-ms-1 shadow-[0_10px_30px_-10px_rgba(201,168,76,0.35)] backdrop-blur-xl"
            style={{ top: "calc(env(safe-area-inset-top) + 68px)" }}
          >
            <IconPill onClick={() => duplicateObject(selectedObj.id)} label="Duplikat"><Copy className="h-4 w-4" /></IconPill>
            <IconPill onClick={() => bringForward(selectedObj.id)} label="Ke depan"><span className="text-ms-sm">↑</span></IconPill>
            <IconPill onClick={() => sendBackward(selectedObj.id)} label="Ke belakang"><span className="text-ms-sm">↓</span></IconPill>
            <IconPill onClick={() => updateObject(selectedObj.id, { locked: !selectedObj.locked })} label="Kunci" active={!!selectedObj.locked}>
              {selectedObj.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </IconPill>
            <IconPill onClick={() => deleteObject(selectedObj.id)} label="Hapus" tone="danger"><Trash2 className="h-4 w-4" /></IconPill>
          </div>
        )}

        {/* Ukuran cepat — muncul saat sticker terpilih. Slider proporsional +
            tombol −/+ supaya membesarkan/mengecilkan stiker gampang di HP,
            tanpa harus mengejar handle kecil. */}
        {selectedObj && selectedObj.kind === "sticker" && (() => {
          const s = selectedObj as StickerObj;
          const aspect = s.height > 0 ? s.width / s.height : 1;
          const resize = (w: number) => {
            const nw = Math.max(40, Math.min(720, Math.round(w)));
            const nh = Math.max(40, Math.round(nw / (aspect || 1)));
            updateObject(s.id, { width: nw, height: nh });
          };
          const preset = STICKER_PRESETS[s.sticker];
          const isArrow = preset?.group === "panah";
          // Normalisasi -180..180 supaya tampilan angka enak dibaca.
          const normRot = (deg: number) => {
            let d = deg % 360;
            if (d > 180) d -= 360;
            if (d <= -180) d += 360;
            return d;
          };
          const setRot = (deg: number) => updateObject(s.id, { rotation: normRot(deg) });
          const nudge = (delta: number) => setRot((s.rotation ?? 0) + delta);
          const snap = (target: number) => setRot(target);
          return (
            <>
            <div
              className="pointer-events-auto absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-ms-2 rounded-full border border-[#c9a84c]/25 bg-[#0d0d0d]/80 px-ms-3 py-ms-1 shadow-[0_10px_30px_-10px_rgba(201,168,76,0.35)] backdrop-blur-xl"
              style={{ top: "calc(env(safe-area-inset-top) + 128px)" }}
            >
              <button
                type="button"
                onClick={() => resize(s.width * 0.8)}
                aria-label="Kecilkan stiker"
                className="grid h-9 w-9 place-items-center rounded-full text-[#f0d78c] hover:bg-[#c9a84c]/15 active:scale-95"
              >
                <span className="text-ms-lg font-bold">−</span>
              </button>
              <input
                type="range"
                min={40}
                max={720}
                step={4}
                value={Math.round(s.width)}
                onChange={(e) => resize(Number(e.target.value))}
                aria-label="Ukuran stiker"
                className="h-9 w-44 accent-[#c9a84c] sm:w-56"
              />
              <button
                type="button"
                onClick={() => resize(s.width * 1.25)}
                aria-label="Perbesar stiker"
                className="grid h-9 w-9 place-items-center rounded-full text-[#f0d78c] hover:bg-[#c9a84c]/15 active:scale-95"
              >
                <span className="text-ms-lg font-bold">+</span>
              </button>
              <span className="w-10 text-center text-ms-2xs tabular-nums text-[#f0d78c]/80">{Math.round(s.width)}</span>
            </div>
            {isArrow && (
              <div
                className="pointer-events-auto absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-ms-1 rounded-full border border-[#c9a84c]/25 bg-[#0d0d0d]/80 px-ms-2 py-ms-1 shadow-[0_10px_30px_-10px_rgba(201,168,76,0.35)] backdrop-blur-xl"
                style={{ top: "calc(env(safe-area-inset-top) + 176px)" }}
                role="group"
                aria-label="Rotasi stiker panah"
              >
                <button
                  type="button"
                  onClick={() => nudge(-15)}
                  aria-label="Rotasi berlawanan 15°"
                  className="grid h-8 w-8 place-items-center rounded-full text-[#f0d78c] hover:bg-[#c9a84c]/15 active:scale-95"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => nudge(-1)}
                  aria-label="Rotasi −1°"
                  className="grid h-8 min-w-8 place-items-center rounded-full px-1.5 text-ms-2xs font-semibold text-[#f0d78c] hover:bg-[#c9a84c]/15 active:scale-95"
                >
                  −1°
                </button>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={Math.round(normRot(s.rotation ?? 0))}
                  onChange={(e) => setRot(Number(e.target.value))}
                  aria-label="Sudut rotasi"
                  className="h-8 w-36 accent-[#c9a84c] sm:w-48"
                />
                <button
                  type="button"
                  onClick={() => nudge(1)}
                  aria-label="Rotasi +1°"
                  className="grid h-8 min-w-8 place-items-center rounded-full px-1.5 text-ms-2xs font-semibold text-[#f0d78c] hover:bg-[#c9a84c]/15 active:scale-95"
                >
                  +1°
                </button>
                <button
                  type="button"
                  onClick={() => nudge(15)}
                  aria-label="Rotasi searah 15°"
                  className="grid h-8 w-8 place-items-center rounded-full text-[#f0d78c] hover:bg-[#c9a84c]/15 active:scale-95"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  min={-180}
                  max={180}
                  step={1}
                  value={Math.round(normRot(s.rotation ?? 0))}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setRot(v);
                  }}
                  aria-label="Sudut presisi"
                  className="h-8 w-14 rounded-md border border-[#c9a84c]/25 bg-white/[0.04] px-1 text-center text-ms-2xs tabular-nums text-[#f0d78c] focus:border-[#c9a84c]/60 focus:outline-none"
                />
                <span className="pr-1 text-ms-2xs text-[#f0d78c]/60">°</span>
                <button
                  type="button"
                  onClick={() => snap(0)}
                  aria-label="Reset rotasi ke 0°"
                  className="ml-0.5 grid h-8 min-w-8 place-items-center rounded-full border border-[#c9a84c]/30 px-1.5 text-ms-2xs font-semibold text-[#f0d78c] hover:bg-[#c9a84c]/15 active:scale-95"
                >
                  0°
                </button>
              </div>
            )}
            </>
          );
        })()}
      </div>

      {/* Panel gaya kontekstual — muncul di atas toolbar HANYA saat tool
          coret/bentuk/teks aktif. Bisa disembunyikan lewat handle X. */}
      {needsStyle && !stylePanelClosed && (
        <div className="pointer-events-auto relative z-20 border-t border-[#c9a84c]/20 bg-[#0d0d0d]/75 px-ms-3 py-ms-2 backdrop-blur-xl animate-fade-in">
          <div className="flex items-center gap-ms-2 overflow-x-auto [scrollbar-width:none]">
            {MCM_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Warna ${c}`}
                onClick={() => {
                  setColor(c);
                  if (selectedObj) {
                    if (selectedObj.kind === "shape") updateObject(selectedObj.id, { stroke: c });
                    else if (selectedObj.kind === "text") updateObject(selectedObj.id, { color: c });
                    else if (selectedObj.kind === "sticker") updateObject(selectedObj.id, { color: c });
                    else if (selectedObj.kind === "draw") updateObject(selectedObj.id, { color: c });
                  }
                }}
                className={cn(
                  "h-8 w-8 shrink-0 rounded-full border-2 transition-transform",
                  color === c
                    ? "scale-110 border-[#c9a84c] ring-2 ring-[#c9a84c]/50"
                    : "border-white/15",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            <label className="relative shrink-0" aria-label="Warna kustom">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              <span
                className="grid h-8 w-8 place-items-center rounded-full border-2 border-[#c9a84c]/40 bg-[conic-gradient(from_0deg,#c9a84c,#f0d78c,#ffffff,#22c55e,#06b6d4,#8b5cf6,#ef4444,#c9a84c)]"
                aria-hidden
              >
                <span className="h-3 w-3 rounded-full bg-[#0d0d0d]" />
              </span>
            </label>
            <div className="ml-ms-2 flex shrink-0 items-center gap-ms-2 text-[#f0d78c]/85">
              <span className="text-ms-2xs uppercase tracking-wide opacity-70">Tebal</span>
              <input
                type="range" min={1} max={40} value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="w-24 accent-[#c9a84c]"
                aria-label="Ketebalan"
              />
              <span className="w-6 text-center text-ms-2xs tabular-nums">{strokeWidth}</span>
            </div>
            <div className="flex shrink-0 items-center gap-ms-2 text-[#f0d78c]/85">
              <span className="text-ms-2xs uppercase tracking-wide opacity-70">Opac</span>
              <input
                type="range" min={0.1} max={1} step={0.05} value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-20 accent-[#c9a84c]"
                aria-label="Opacity"
              />
              <span className="w-8 text-center text-ms-2xs tabular-nums">{Math.round(opacity * 100)}%</span>
            </div>
            <button
              type="button"
              onClick={() => setStylePanelClosed(true)}
              aria-label="Sembunyikan panel gaya"
              className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#f0d78c]/70 hover:bg-[#c9a84c]/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Toolbar utama — glass, satu baris scrollable. Testid & aria-label
          dipertahankan agar spec e2e existing tetap hijau. */}
      <nav
        className="relative z-20 shrink-0 border-t border-[#c9a84c]/20 bg-[#0d0d0d]/85 backdrop-blur-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-stretch gap-ms-1 overflow-x-auto px-ms-2 py-ms-2 [scrollbar-width:none]">
          <ToolPill active={tool === "pilih"} onClick={() => { setTool("pilih"); setStylePanelClosed(false); }} label="Pilih" Icon={MousePointer2} testId="photo-editor-tool-pilih" />
          <span className="mx-ms-1 my-auto h-8 w-px shrink-0 bg-[#c9a84c]/20" aria-hidden />
          <ToolPill active={tool === "coret"} onClick={() => { setTool("coret"); setStylePanelClosed(false); }} label="Coret" Icon={Pencil} testId="photo-editor-tool-coret" />
          <ToolPill active={tool === "highlighter"} onClick={() => { setTool("highlighter"); setStylePanelClosed(false); }} label="Marker" Icon={Highlighter} />
          <ToolPill active={tool === "brush"} onClick={() => { setTool("brush"); setStylePanelClosed(false); }} label="Brush" Icon={Brush} />
          <ToolPill active={tool === "eraser"} onClick={() => { setTool("eraser"); setStylePanelClosed(false); }} label="Hapus" Icon={Eraser} />
          <span className="mx-ms-1 my-auto h-8 w-px shrink-0 bg-[#c9a84c]/20" aria-hidden />
          <ToolPill active={tool === "panah"} onClick={() => { setTool("panah"); setStylePanelClosed(false); }} label="Panah" Icon={MoveUpRight} testId="photo-editor-tool-panah" />
          <ToolPill active={tool === "kotak"} onClick={() => { setTool("kotak"); setStylePanelClosed(false); }} label="Kotak" Icon={Square} testId="photo-editor-tool-kotak" />
          <ToolPill active={tool === "lingkaran"} onClick={() => { setTool("lingkaran"); setStylePanelClosed(false); }} label="Lingkaran" Icon={CircleIcon} testId="photo-editor-tool-lingkaran" />
          <ToolPill active={tool === "segitiga"} onClick={() => { setTool("segitiga"); setStylePanelClosed(false); }} label="Segitiga" Icon={TriangleIcon} />
          <span className="mx-ms-1 my-auto h-8 w-px shrink-0 bg-[#c9a84c]/20" aria-hidden />
          <ToolPill active={tool === "teks"} onClick={() => { setTool("teks"); setStylePanelClosed(false); }} label="Teks" Icon={Type} testId="photo-editor-tool-teks" />
          <ToolPill active={showStickers} onClick={() => setShowStickers((v) => !v)} label="Stiker" Icon={Sticker} testId="photo-editor-tool-stiker" />
        </div>
      </nav>

      {/* Sticker sheet */}
      {showStickers && (
        <div className="absolute inset-x-0 bottom-20 z-30 max-h-[55vh] overflow-y-auto rounded-t-2xl border border-[#c9a84c]/25 bg-[#0d0d0d]/95 p-ms-3 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl animate-slide-in-right">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-ms-sm font-medium tracking-wide text-[#f0d78c]">Stiker</div>
            <button onClick={() => setShowStickers(false)} className="grid h-7 w-7 place-items-center rounded-full text-[#f0d78c]/70 hover:bg-[#c9a84c]/10"><X className="h-4 w-4" /></button>
          </div>
          {/* Kontrol gaya 3D global — mempengaruhi semua stiker di kanvas
              maupun preview thumbnail di sheet ini. */}
          <div className="mb-3 rounded-xl border border-[#c9a84c]/15 bg-white/[0.02] p-ms-2">
            <div className="mb-1.5 px-1 text-ms-2xs font-semibold uppercase tracking-[0.14em] text-[#f0d78c]/60">
              Gaya 3D
            </div>
            {([
              { label: "Shadow", value: stickerShadow, set: setStickerShadow },
              { label: "Glossy", value: stickerGloss, set: setStickerGloss },
              { label: "Rim", value: stickerRim, set: setStickerRim },
            ] as const).map((row) => (
              <div key={row.label} className="flex items-center gap-ms-2 py-0.5">
                <span className="w-14 shrink-0 text-ms-2xs text-[#f0d78c]/80">{row.label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={row.value}
                  onChange={(e) => row.set(Number(e.target.value))}
                  className="flex-1 accent-[#c9a84c]"
                  aria-label={`Intensitas ${row.label}`}
                />
                <span className="w-9 shrink-0 text-right text-ms-2xs tabular-nums text-white/70">{row.value}</span>
              </div>
            ))}
          </div>
          {(["panah", "status", "reaksi"] as const).map((group) => {
            const entries = Object.entries(STICKER_PRESETS).filter(([, p]) => p.group === group);
            if (entries.length === 0) return null;
            const label = group === "panah" ? "Panah" : group === "status" ? "Status" : "Reaksi";
            return (
              <div key={group} className="mb-3 last:mb-1">
                <div className="mb-1.5 px-1 text-ms-2xs font-semibold uppercase tracking-[0.14em] text-[#f0d78c]/60">
                  {label}
                </div>
                <div className="grid grid-cols-4 gap-ms-2">
                  {entries.map(([key, preset]) => {
                    const Ic = preset.Icon;
                    const base = preset.defaultColor;
                    const light = shadeHex(base, 0.55);
                    const dark = shadeHex(base, -0.35);
                    const isArrow = preset.group === "panah";
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => addSticker(key)}
                        aria-label={`Tambah stiker ${preset.label}`}
                        className="group flex flex-col items-center gap-ms-1 rounded-xl border border-[#c9a84c]/15 bg-white/[0.03] p-ms-2 text-white/90 transition hover:border-[#c9a84c]/40 hover:bg-[#c9a84c]/10 active:scale-95"
                      >
                        {isArrow ? (
                          // Panah modern — flat, tanpa medali. Warna aksen brand.
                          <span
                            className="grid h-11 w-11 place-items-center"
                            style={{
                              color: base,
                              filter: `drop-shadow(0 2px 4px rgba(0,0,0,${0.5 * (stickerShadow / 100)}))`,
                            }}
                          >
                            <Ic className="h-8 w-8" strokeWidth={2.75} />
                          </span>
                        ) : (
                          <span
                            className="relative grid h-11 w-11 place-items-center rounded-full text-white ring-1 ring-black/40"
                            style={{
                              background: `radial-gradient(circle at 32% 28%, ${light} 0%, ${base} 55%, ${dark} 100%)`,
                              boxShadow: `0 ${6 * (stickerShadow / 100)}px ${14 * (stickerShadow / 100)}px -4px rgba(0,0,0,${0.7 * (stickerShadow / 100)}), inset 0 1px 0 rgba(255,255,255,${0.35 * (stickerRim / 100)})`,
                            }}
                          >
                            <Ic className="h-[22px] w-[22px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]" />
                            <span
                              aria-hidden
                              className="pointer-events-none absolute inset-x-2 top-1 h-2 rounded-full blur-[2px]"
                              style={{ background: `rgba(255,255,255,${0.55 * (stickerGloss / 100)})` }}
                            />
                          </span>
                        )}
                        <span className="text-ms-2xs text-[#f0d78c]/90">{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Text editor sheet */}
      {showText && (() => {
        const obj = scene.objects.find((o) => o.id === showText.id && o.kind === "text") as TextObj | undefined;
        if (!obj) return null;
        return (
          <div className="absolute inset-x-0 bottom-0 z-40 rounded-t-2xl border border-[#c9a84c]/25 bg-[#0d0d0d]/95 p-ms-3 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl animate-fade-in">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-ms-sm font-medium tracking-wide text-[#f0d78c]">Ubah Teks</div>
              <button onClick={() => setShowText(null)} className="grid h-7 w-7 place-items-center rounded-full text-[#f0d78c]/70 hover:bg-[#c9a84c]/10"><X className="h-4 w-4" /></button>
            </div>
            <textarea
              className="w-full rounded-lg border border-[#c9a84c]/25 bg-white/[0.03] p-ms-2 text-ms-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#c9a84c]/50"
              rows={3}
              value={obj.text}
              onChange={(e) => updateObject(obj.id, { text: e.target.value })}
              autoFocus
            />
            <div className="mt-2 flex flex-wrap items-center gap-ms-2">
              <button className={cn("h-9 rounded-full border px-ms-3 text-ms-sm font-bold transition", obj.bold ? "border-[#c9a84c] bg-[#c9a84c] text-[#0d0d0d]" : "border-[#c9a84c]/20 text-white hover:bg-[#c9a84c]/10")} onClick={() => updateObject(obj.id, { bold: !obj.bold })}>B</button>
              <button className={cn("h-9 rounded-full border px-ms-3 text-ms-sm italic transition", obj.italic ? "border-[#c9a84c] bg-[#c9a84c] text-[#0d0d0d]" : "border-[#c9a84c]/20 text-white hover:bg-[#c9a84c]/10")} onClick={() => updateObject(obj.id, { italic: !obj.italic })}>I</button>
              <button className={cn("h-9 rounded-full border px-ms-3 text-ms-sm transition", obj.outline ? "border-[#c9a84c] bg-[#c9a84c] text-[#0d0d0d]" : "border-[#c9a84c]/20 text-white hover:bg-[#c9a84c]/10")} onClick={() => updateObject(obj.id, { outline: obj.outline ? undefined : "#000000" })}>Outline</button>
              <button className={cn("h-9 rounded-full border px-ms-3 text-ms-sm transition", obj.shadow ? "border-[#c9a84c] bg-[#c9a84c] text-[#0d0d0d]" : "border-[#c9a84c]/20 text-white hover:bg-[#c9a84c]/10")} onClick={() => updateObject(obj.id, { shadow: !obj.shadow })}>Shadow</button>
              <select className="h-9 rounded-full border border-[#c9a84c]/25 bg-white/[0.03] px-ms-2 text-ms-sm text-white" value={obj.align} onChange={(e) => updateObject(obj.id, { align: e.target.value as TextObj["align"] })}>
                <option value="left">Kiri</option>
                <option value="center">Tengah</option>
                <option value="right">Kanan</option>
              </select>
              <input type="range" min={12} max={120} value={obj.fontSize} onChange={(e) => updateObject(obj.id, { fontSize: Number(e.target.value) })} className="w-28 accent-[#c9a84c]" aria-label="Ukuran font" />
            </div>
          </div>
        );
      })()}

      {/* Layers sheet */}
      {showLayers && (
        <div className="absolute inset-x-0 bottom-20 z-30 max-h-[50vh] overflow-auto rounded-t-2xl border border-[#c9a84c]/25 bg-[#0d0d0d]/95 p-ms-3 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl animate-fade-in">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-ms-sm font-medium tracking-wide text-[#f0d78c]">Layer ({scene.objects.length})</div>
            <button onClick={() => setShowLayers(false)} className="grid h-7 w-7 place-items-center rounded-full text-[#f0d78c]/70 hover:bg-[#c9a84c]/10"><X className="h-4 w-4" /></button>
          </div>
          <ul className="space-y-1">
            {[...scene.objects].reverse().map((o) => (
              <li key={o.id} className={cn("flex items-center gap-ms-2 rounded-lg border p-ms-2 text-ms-sm text-white/90 transition", selectedId === o.id ? "border-[#c9a84c]/60 bg-[#c9a84c]/10" : "border-[#c9a84c]/15 bg-white/[0.03] hover:border-[#c9a84c]/30")}>
                <button className="flex-1 text-left" onClick={() => setSelectedId(o.id)}>{layerLabel(o)}</button>
                <button aria-label="Sembunyikan" className="grid h-7 w-7 place-items-center rounded-md hover:bg-[#c9a84c]/10" onClick={() => updateObject(o.id, { visible: o.visible === false })}>
                  {o.visible === false ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button aria-label="Kunci" className="grid h-7 w-7 place-items-center rounded-md hover:bg-[#c9a84c]/10" onClick={() => updateObject(o.id, { locked: !o.locked })}>
                  {o.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                </button>
                <button aria-label="Duplikat" className="grid h-7 w-7 place-items-center rounded-md hover:bg-[#c9a84c]/10" onClick={() => duplicateObject(o.id)}><Copy className="h-4 w-4" /></button>
                <button aria-label="Hapus" className="grid h-7 w-7 place-items-center rounded-md text-destructive hover:bg-destructive/20" onClick={() => deleteObject(o.id)}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
            {scene.objects.length === 0 && <li className="text-ms-xs text-[#f0d78c]/50">Belum ada objek</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Tombol tool berbentuk pill glass. Ukuran minimum 48×56 supaya nyaman
 * ditap satu jari di HP 411px; state aktif memakai kontras putih vs
 * neutral-900 (bukan warna semantic) karena editor berjalan di kanvas
 * gelap penuh.
 */
function ToolPill(props: { active: boolean; onClick: () => void; label: string; Icon: typeof MousePointer2; testId?: string }) {
  const { active, onClick, label, Icon, testId } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "flex min-h-[52px] min-w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-ms-2 text-ms-2xs transition-all",
        active
          ? "bg-gradient-to-b from-[#f0d78c] to-[#c9a84c] text-[#0d0d0d] shadow-[0_6px_16px_-6px_rgba(201,168,76,0.55)] ring-1 ring-[#c9a84c]/60"
          : "text-[#f5f0e0]/85 hover:bg-[#c9a84c]/10 hover:text-[#f0d78c] active:bg-[#c9a84c]/15",
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="font-medium">{label}</span>
    </button>
  );
}

/**
 * Tombol ikon bulat untuk header/kontrol melayang. Kontras putih terhadap
 * kanvas gelap, tap-target 40px (nyaman di HP 411px). Prop `tone="danger"`
 * dipakai untuk aksi merusak seperti hapus layer terpilih.
 */
function IconPill(props: {
  onClick: () => void;
  label: string;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
  tone?: "default" | "danger";
}) {
  const { onClick, label, children, disabled, active, tone = "default" } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        "grid h-10 w-10 place-items-center rounded-full text-[#f5f0e0]/90 transition-all",
        !disabled && "hover:bg-[#c9a84c]/12 hover:text-[#f0d78c] active:scale-95",
        active && "bg-gradient-to-b from-[#f0d78c] to-[#c9a84c] text-[#0d0d0d] shadow-[0_4px_12px_-4px_rgba(201,168,76,0.55)]",
        tone === "danger" && "text-destructive-foreground hover:bg-destructive/30",
        disabled && "opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function stickerGlyph(k: string): string {
  switch (k) {
    case "arrow": return "→";
    case "arrow-left": return "←";
    case "arrow-up": return "↑";
    case "arrow-down": return "↓";
    case "arrow-upright": return "↗";
    case "arrow-upleft": return "↖";
    case "arrow-both": return "↔";
    case "arrow-curve": return "↩";
    case "arrow-curve-r": return "↪";
    case "arrow-curve-dl": return "↲";
    case "arrow-curve-dr": return "↳";
    case "arrow-bold-r": return "➜";
    case "arrow-bold-l": return "⬅";
    case "arrow-bold-u": return "⬆";
    case "arrow-bold-d": return "⬇";
    case "arrow-rotate-cw": return "↻";
    case "arrow-rotate-ccw": return "↺";
    case "arrow-refresh": return "⟳";
    case "check": return "✓";
    case "x": return "✕";
    case "warning": return "!";
    case "location": return "◉";
    case "package": return "▣";
    case "paid": return "$";
    case "pending": return "◐";
    case "verified": return "✓";
    case "fire": return "🔥";
    case "bolt": return "⚡";
    case "heart": return "♥";
    case "star": return "★";
    case "thumb": return "👍";
    default: return "•";
  }
}

function layerLabel(o: SceneObject): string {
  if (o.kind === "draw") return `Coretan (${o.tool})`;
  if (o.kind === "shape") return `Bentuk: ${o.shape}`;
  if (o.kind === "text") return `Teks: ${o.text.slice(0, 20)}`;
  if (o.kind === "sticker") return `Stiker: ${STICKER_PRESETS[o.sticker]?.label ?? o.sticker}`;
  return "Objek";
}

export default PhotoEditorV2;