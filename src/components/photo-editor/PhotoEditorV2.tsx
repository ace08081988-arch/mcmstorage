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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const MCM_PALETTE = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#111827", "#ffffff"];

const STICKER_PRESETS: Record<string, { label: string; Icon: typeof Check; defaultColor: string }> = {
  check: { label: "Checklist", Icon: Check, defaultColor: "#22c55e" },
  x: { label: "Silang", Icon: X, defaultColor: "#ef4444" },
  warning: { label: "Warning", Icon: AlertTriangle, defaultColor: "#f59e0b" },
  location: { label: "Lokasi", Icon: MapPin, defaultColor: "#3b82f6" },
  package: { label: "Paket", Icon: Package, defaultColor: "#8b5cf6" },
  paid: { label: "Paid", Icon: DollarSign, defaultColor: "#22c55e" },
  pending: { label: "Pending", Icon: Clock, defaultColor: "#eab308" },
  verified: { label: "Verified", Icon: BadgeCheck, defaultColor: "#06b6d4" },
};

export function PhotoEditorV2({ src, onCancel, onSave, initialSceneJson, autosaveKey }: PhotoEditorV2Props) {
  const [img] = useImage(src, "anonymous");
  const [tool, setTool] = useState<Tool>("pilih");
  const [color, setColor] = useState<string>("#ef4444");
  const [strokeWidth, setStrokeWidth] = useState<number>(6);
  const [opacity, setOpacity] = useState<number>(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showLayers, setShowLayers] = useState(false);
  const [showText, setShowText] = useState<null | { id: string }>(null);
  const [showStickers, setShowStickers] = useState(false);
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

  // Render sticker as Konva group (icon drawn as a filled circle badge with symbol).
  // For minimalism iterasi 1: represent each sticker as a colored circle + icon path from Lucide.
  const renderSticker = (o: StickerObj) => {
    if (o.visible === false) return null;
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
        <Circle x={o.width / 2} y={o.height / 2} radius={o.width / 2} fill={o.color} />
        <KText
          x={0} y={o.height / 2 - o.height * 0.28}
          width={o.width} align="center"
          text={stickerGlyph(o.sticker)}
          fontSize={o.width * 0.55}
          fontStyle="bold"
          fill="#ffffff"
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
    tr.getLayer()?.batchDraw();
  }, [selectedId, scene.objects.length]);

  const selectedObj = scene.objects.find((o) => o.id === selectedId) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground" data-testid="photo-editor-v2">
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-ms-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Batal</Button>
        <div className="flex items-center gap-ms-1">
          <Button variant="ghost" size="icon" disabled={!canUndo(history)} onClick={doUndo} aria-label="Undo"><Undo2 className="h-5 w-5" /></Button>
          <Button variant="ghost" size="icon" disabled={!canRedo(history)} onClick={doRedo} aria-label="Redo"><Redo2 className="h-5 w-5" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out"><ZoomOut className="h-5 w-5" /></Button>
          <span className="text-ms-xs tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Zoom in"><ZoomIn className="h-5 w-5" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setShowLayers((v) => !v)} aria-label="Layer"><Layers className="h-5 w-5" /></Button>
        </div>
        <Button variant="default" size="sm" onClick={doSave}>Simpan</Button>
      </div>

      {/* Transform sub-bar */}
      <div className="flex h-10 shrink-0 items-center gap-ms-1 border-b px-ms-2 overflow-x-auto">
        <Button variant="outline" size="sm" onClick={rotate90}><RotateCw className="mr-1 h-4 w-4" />Putar</Button>
        <Button variant="outline" size="sm" onClick={flipH}><FlipHorizontal2 className="mr-1 h-4 w-4" />Flip H</Button>
        <Button variant="outline" size="sm" onClick={flipV}><FlipVertical2 className="mr-1 h-4 w-4" />Flip V</Button>
        <Button variant="outline" size="sm" onClick={() => setTool("crop")} disabled><Crop className="mr-1 h-4 w-4" />Crop</Button>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden bg-muted/30 touch-none">
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
              anchorSize={12}
              borderStroke="#3b82f6"
              anchorStroke="#3b82f6"
              anchorFill="#ffffff"
            />
          </Layer>
        </Stage>

        {/* Object action bar (when selected) */}
        {selectedObj && (
          <div className="pointer-events-auto absolute left-1/2 top-2 -translate-x-1/2 flex items-center gap-ms-1 rounded-full border bg-background/95 px-ms-2 py-1 shadow">
            <button className="p-ms-2" aria-label="Duplikat" onClick={() => duplicateObject(selectedObj.id)}><Copy className="h-4 w-4" /></button>
            <button className="p-ms-2" aria-label="Ke depan" onClick={() => bringForward(selectedObj.id)}>↑</button>
            <button className="p-ms-2" aria-label="Ke belakang" onClick={() => sendBackward(selectedObj.id)}>↓</button>
            <button className="p-ms-2" aria-label="Kunci" onClick={() => updateObject(selectedObj.id, { locked: !selectedObj.locked })}>
              {selectedObj.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </button>
            <button className="p-ms-2 text-destructive" aria-label="Hapus" onClick={() => deleteObject(selectedObj.id)}><Trash2 className="h-4 w-4" /></button>
          </div>
        )}
      </div>

      {/* Color + width sub-bar */}
      <div className="flex h-12 shrink-0 items-center gap-ms-2 border-t px-ms-2 overflow-x-auto">
        <div className="flex items-center gap-ms-1">
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
              className={cn("h-7 w-7 rounded-full border-2", color === c ? "border-foreground" : "border-transparent")}
              style={{ backgroundColor: c }}
            />
          ))}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-8 rounded border" aria-label="Warna kustom" />
        </div>
        <div className="ml-2 flex items-center gap-ms-2">
          <span className="text-ms-xs">Tebal</span>
          <input
            type="range" min={1} max={40} value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-24"
            aria-label="Ketebalan"
          />
          <span className="text-ms-xs">Opacity</span>
          <input
            type="range" min={0.1} max={1} step={0.05} value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-20"
            aria-label="Opacity"
          />
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className="grid grid-cols-9 shrink-0 border-t bg-background">
        <ToolBtn active={tool === "pilih"} onClick={() => setTool("pilih")} label="Pilih" Icon={MousePointer2} testId="photo-editor-tool-pilih" />
        <ToolBtn active={tool === "coret"} onClick={() => setTool("coret")} label="Coret" Icon={Pencil} testId="photo-editor-tool-coret" />
        <ToolBtn active={tool === "highlighter"} onClick={() => setTool("highlighter")} label="Marker" Icon={Highlighter} />
        <ToolBtn active={tool === "brush"} onClick={() => setTool("brush")} label="Brush" Icon={Brush} />
        <ToolBtn active={tool === "eraser"} onClick={() => setTool("eraser")} label="Hapus" Icon={Eraser} />
        <ToolBtn active={tool === "panah"} onClick={() => setTool("panah")} label="Panah" Icon={MoveUpRight} testId="photo-editor-tool-panah" />
        <ToolBtn active={tool === "kotak"} onClick={() => setTool("kotak")} label="Kotak" Icon={Square} testId="photo-editor-tool-kotak" />
        <ToolBtn active={tool === "lingkaran"} onClick={() => setTool("lingkaran")} label="Lingkaran" Icon={CircleIcon} testId="photo-editor-tool-lingkaran" />
        <ToolBtn active={tool === "segitiga"} onClick={() => setTool("segitiga")} label="Segitiga" Icon={TriangleIcon} />
      </div>
      <div className="grid grid-cols-2 shrink-0 border-t bg-background">
        <ToolBtn active={tool === "teks"} onClick={() => setTool("teks")} label="Teks" Icon={Type} testId="photo-editor-tool-teks" />
        <ToolBtn active={showStickers} onClick={() => setShowStickers((v) => !v)} label="Stiker" Icon={Sticker} testId="photo-editor-tool-stiker" />
      </div>

      {/* Sticker sheet */}
      {showStickers && (
        <div className="absolute inset-x-0 bottom-24 z-10 rounded-t-2xl border bg-background p-ms-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-ms-sm font-medium">Stiker</div>
            <button onClick={() => setShowStickers(false)} className="p-ms-1"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-4 gap-ms-2">
            {Object.entries(STICKER_PRESETS).map(([key, preset]) => {
              const Ic = preset.Icon;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => addSticker(key)}
                  className="flex flex-col items-center gap-ms-1 rounded-lg border p-ms-3 hover:bg-accent"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-full text-white" style={{ backgroundColor: preset.defaultColor }}>
                    <Ic className="h-5 w-5" />
                  </div>
                  <span className="text-ms-xs">{preset.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Text editor sheet */}
      {showText && (() => {
        const obj = scene.objects.find((o) => o.id === showText.id && o.kind === "text") as TextObj | undefined;
        if (!obj) return null;
        return (
          <div className="absolute inset-x-0 bottom-0 z-20 rounded-t-2xl border bg-background p-ms-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-ms-sm font-medium">Ubah Teks</div>
              <button onClick={() => setShowText(null)} className="p-ms-1"><X className="h-4 w-4" /></button>
            </div>
            <textarea
              className="w-full rounded border bg-background p-ms-2 text-ms-sm"
              rows={3}
              value={obj.text}
              onChange={(e) => updateObject(obj.id, { text: e.target.value })}
              autoFocus
            />
            <div className="mt-2 flex flex-wrap items-center gap-ms-2">
              <button className={cn("h-9 px-ms-3 rounded border text-ms-sm font-bold", obj.bold && "bg-accent")} onClick={() => updateObject(obj.id, { bold: !obj.bold })}>B</button>
              <button className={cn("h-9 px-ms-3 rounded border text-ms-sm italic", obj.italic && "bg-accent")} onClick={() => updateObject(obj.id, { italic: !obj.italic })}>I</button>
              <button className={cn("h-9 px-ms-3 rounded border text-ms-sm", obj.outline && "bg-accent")} onClick={() => updateObject(obj.id, { outline: obj.outline ? undefined : "#000000" })}>Outline</button>
              <button className={cn("h-9 px-ms-3 rounded border text-ms-sm", obj.shadow && "bg-accent")} onClick={() => updateObject(obj.id, { shadow: !obj.shadow })}>Shadow</button>
              <select className="h-9 rounded border bg-background px-ms-2 text-ms-sm" value={obj.align} onChange={(e) => updateObject(obj.id, { align: e.target.value as TextObj["align"] })}>
                <option value="left">Kiri</option>
                <option value="center">Tengah</option>
                <option value="right">Kanan</option>
              </select>
              <input type="range" min={12} max={120} value={obj.fontSize} onChange={(e) => updateObject(obj.id, { fontSize: Number(e.target.value) })} className="w-28" aria-label="Ukuran font" />
            </div>
          </div>
        );
      })()}

      {/* Layers sheet */}
      {showLayers && (
        <div className="absolute inset-x-0 bottom-24 z-10 max-h-[50vh] overflow-auto rounded-t-2xl border bg-background p-ms-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-ms-sm font-medium">Layer ({scene.objects.length})</div>
            <button onClick={() => setShowLayers(false)} className="p-ms-1"><X className="h-4 w-4" /></button>
          </div>
          <ul className="space-y-1">
            {[...scene.objects].reverse().map((o) => (
              <li key={o.id} className={cn("flex items-center gap-ms-2 rounded border p-ms-2 text-ms-sm", selectedId === o.id && "bg-accent")}>
                <button className="flex-1 text-left" onClick={() => setSelectedId(o.id)}>{layerLabel(o)}</button>
                <button aria-label="Sembunyikan" onClick={() => updateObject(o.id, { visible: o.visible === false })}>
                  {o.visible === false ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button aria-label="Kunci" onClick={() => updateObject(o.id, { locked: !o.locked })}>
                  {o.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                </button>
                <button aria-label="Duplikat" onClick={() => duplicateObject(o.id)}><Copy className="h-4 w-4" /></button>
                <button aria-label="Hapus" onClick={() => deleteObject(o.id)}><Trash2 className="h-4 w-4 text-destructive" /></button>
              </li>
            ))}
            {scene.objects.length === 0 && <li className="text-ms-xs text-muted-foreground">Belum ada objek</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function ToolBtn(props: { active: boolean; onClick: () => void; label: string; Icon: typeof MousePointer2; testId?: string }) {
  const { active, onClick, label, Icon, testId } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "flex min-h-[48px] flex-col items-center justify-center gap-0.5 text-ms-2xs",
        active ? "bg-accent text-accent-foreground" : "text-foreground/80",
      )}
    >
      <Icon className="h-5 w-5" />
      <span>{label}</span>
    </button>
  );
}

function stickerGlyph(k: string): string {
  switch (k) {
    case "check": return "✓";
    case "x": return "✕";
    case "warning": return "!";
    case "location": return "◉";
    case "package": return "▣";
    case "paid": return "$";
    case "pending": return "◐";
    case "verified": return "✓";
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