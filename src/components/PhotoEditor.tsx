import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight,
  Type, Eraser, Undo2, Redo2, RotateCw, Square, Circle, Pencil, Trash2,
  X, Check, Smile, MoveUp, MoveDown, Copy as CopyIcon, ZoomIn, ZoomOut, Maximize2, Minimize2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type LayerBase = { id: string; x: number; y: number; rotation: number; scale: number; color: string };
type ArrowDir = "up" | "down" | "left" | "right" | "upleft" | "upright" | "downleft" | "downright";
type Layer =
  | ({ kind: "text"; text: string; size: number; bold: boolean } & LayerBase)
  | ({ kind: "emoji"; emoji: string; size: number } & LayerBase)
  | ({ kind: "arrow"; dir: ArrowDir; size: number; thickness: number } & LayerBase)
  | ({ kind: "rect"; w: number; h: number; thickness: number; fill: boolean } & LayerBase)
  | ({ kind: "circle"; r: number; thickness: number; fill: boolean } & LayerBase)
  | ({ kind: "stroke"; points: { x: number; y: number }[]; thickness: number } & LayerBase);

type EditorState = {
  layers: Layer[];
  rotation: 0 | 90 | 180 | 270;
};

const EMOJIS = ["⭐", "✅", "❗", "❌", "🔴", "🟢", "🟡", "🔵", "💡", "🔥", "👀", "📦", "🏷️", "📍", "🚚", "💰"];
const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#000000", "#ffffff"];

type Tool = "select" | "draw" | "text" | "emoji" | "arrow" | "rect" | "circle";

function uid() { return Math.random().toString(36).slice(2, 10); }

export type PhotoEditorProps = {
  src: string;
  onCancel: () => void;
  onSave: (blob: Blob, dataUrl: string) => void;
};

export function PhotoEditor({ src, onCancel, onSave }: PhotoEditorProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  const [state, setState] = useState<EditorState>({ layers: [], rotation: 0 });
  const [history, setHistory] = useState<EditorState[]>([]);
  const [future, setFuture] = useState<EditorState[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#ef4444");
  const [thickness, setThickness] = useState(6);
  const [textSize, setTextSize] = useState(32);
  const [arrowDir, setArrowDir] = useState<ArrowDir>("right");
  const [emoji, setEmoji] = useState("⭐");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // drag/draw kept in refs — pointermove no longer triggers React re-renders
  const dragLiveRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const drawingRef = useRef<Layer | null>(null);
  // pre-change snapshot for drag / slider so undo restores the BEFORE state
  const commitBaselineRef = useRef<EditorState | null>(null);
  // last pointer position during a drag (for stroke translation)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  // Cached base (image + rotation) rendered once per (img, view, rotation)
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // rAF scheduler so multiple pointer events coalesce into one paint
  const rafIdRef = useRef<number | null>(null);
  // Refs mirroring reactive values so render() doesn't depend on closures
  const stateRef = useRef<EditorState>({ layers: [], rotation: 0 });
  const viewRef = useRef({ w: 0, h: 0 });
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const [textPrompt, setTextPrompt] = useState<{ open: boolean; x: number; y: number; value: string }>(
    { open: false, x: 0, y: 0, value: "" },
  );
  const [previewZoom, setPreviewZoom] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [exportBg, setExportBg] = useState<"white" | "transparent">("white");
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null);
  const [savePreview, setSavePreview] = useState<{ open: boolean; dataUrl: string; blob: Blob | null; building: boolean }>(
    { open: false, dataUrl: "", blob: null, building: false },
  );

  function onPreviewPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = previewScrollRef.current; if (!el) return;
    panRef.current = { x: e.clientX, y: e.clientY, sx: el.scrollLeft, sy: el.scrollTop };
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
  }
  function onPreviewPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = previewScrollRef.current; const p = panRef.current;
    if (!el || !p) return;
    el.scrollLeft = p.sx - (e.clientX - p.x);
    el.scrollTop = p.sy - (e.clientY - p.y);
  }
  function onPreviewPointerUp() { panRef.current = null; }

  // Load image
  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setImg(null);

    const finish = (i: HTMLImageElement) => {
      if (cancelled) return;
      imgRef.current = i;
      setImg(i);
      setLoadState("ready");
    };

    // First attempt: request with CORS so the canvas stays exportable.
    const corsImg = new Image();
    corsImg.crossOrigin = "anonymous";
    corsImg.onload = () => finish(corsImg);
    corsImg.onerror = () => {
      // Fallback: some hosts (or data: URLs) don't send CORS headers.
      // Retry without crossOrigin so the editor still shows the photo.
      // The canvas may become "tainted" — toDataURL/toBlob can fail; we
      // surface that at export time.
      if (cancelled) return;
      const plain = new Image();
      plain.onload = () => finish(plain);
      plain.onerror = () => { if (!cancelled) setLoadState("error"); };
      plain.src = src;
    };
    corsImg.src = src;

    return () => { cancelled = true; };
  }, [src]);

  // Compute view size based on container width
  useEffect(() => {
    if (!img || !wrapRef.current) return;
    const el = wrapRef.current;
    const update = () => {
      // Wrap might briefly report 0 right after portal mount on some
      // browsers — fall back to the viewport width minus padding so the
      // canvas never gets stuck at zero (which used to leave the black
      // background showing instead of the photo).
      const measuredW = el.clientWidth;
      const fallbackW = typeof window !== "undefined" ? Math.max(window.innerWidth - 16, 0) : 0;
      const containerW = measuredW > 0 ? measuredW : fallbackW;
      const measuredH = el.clientHeight;
      const viewportH = typeof window !== "undefined" ? window.innerHeight - 240 : 560;
      const containerH = Math.max(160, Math.min(measuredH > 0 ? measuredH : viewportH, 720));
      if (containerW <= 0) return false;
      const rotated = state.rotation === 90 || state.rotation === 270;
      const baseW = rotated ? img.height : img.width;
      const baseH = rotated ? img.width : img.height;
      const r = baseW / baseH;
      let w = containerW, h = containerW / r;
      if (h > containerH) { h = containerH; w = h * r; }
      // Avoid useless setState churn when value is unchanged.
      setView((prev) => (Math.round(prev.w) === Math.round(w) && Math.round(prev.h) === Math.round(h) ? prev : { w, h }));
      return true;
    };
    // Try immediately; if the wrap hasn't been measured yet, retry on the
    // next animation frame and again after a short delay to cover slow
    // layouts (mobile Safari sometimes needs an extra tick).
    if (!update()) {
      const raf = requestAnimationFrame(() => {
        if (!update()) setTimeout(update, 50);
      });
      // best-effort cleanup
      return () => cancelAnimationFrame(raf);
    }
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => update()) : null;
    ro?.observe(el);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [img, state.rotation]);

  // Build (and re-build) the base canvas only when image / view / rotation changes.
  // This avoids re-rasterising the (often large) source image on every paint.
  useEffect(() => {
    if (!img || !view.w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = document.createElement("canvas");
    base.width = Math.round(view.w * dpr);
    base.height = Math.round(view.h * dpr);
    const ctx = base.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = "high";
    // Fill white background for white-bg export so transparent PNGs don't look black.
    // For transparent export, leave the base canvas clear so the original alpha shows through.
    if (exportBg === "white") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, view.w, view.h);
    } else {
      ctx.clearRect(0, 0, view.w, view.h);
    }
    ctx.save();
    ctx.translate(view.w / 2, view.h / 2);
    ctx.rotate((state.rotation * Math.PI) / 180);
    const rotated = state.rotation === 90 || state.rotation === 270;
    const dw = rotated ? view.h : view.w;
    const dh = rotated ? view.w : view.h;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    baseCanvasRef.current = base;
    scheduleRedraw();
  }, [img, view, state.rotation, exportBg]);

  // Composite layer pass — copies cached base then draws layers + in-progress shape.
  function render() {
    const cvs = canvasRef.current;
    const base = baseCanvasRef.current;
    const v = viewRef.current;
    if (!cvs || !base || !v.w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(v.w * dpr), H = Math.round(v.h * dpr);
    if (cvs.width !== W || cvs.height !== H) {
      cvs.width = W; cvs.height = H;
      cvs.style.width = `${v.w}px`; cvs.style.height = `${v.h}px`;
    }
    const ctx = cvs.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const drag = dragLiveRef.current;
    for (const l of stateRef.current.layers) {
      const sel = selectedIdRef.current === l.id;
      if (drag && l.id === drag.id && (drag.dx || drag.dy)) {
        const moved: Layer = l.kind === "stroke"
          ? { ...l, points: l.points.map((pt) => ({ x: pt.x + drag.dx, y: pt.y + drag.dy })) }
          : ({ ...l, x: l.x + drag.dx, y: l.y + drag.dy } as Layer);
        drawLayer(ctx, moved, sel);
      } else {
        drawLayer(ctx, l, sel);
      }
    }
    if (drawingRef.current) drawLayer(ctx, drawingRef.current, false);
  }

  function scheduleRedraw() {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      render();
    });
  }

  // Repaint whenever reactive state changes (layers, view, selection)
  useEffect(() => { scheduleRedraw(); }, [state, view, selectedId]);
  useEffect(() => () => { if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current); }, []);

  function pushHistory(next: EditorState) {
    setHistory((h) => [...h.slice(-29), state]);
    setFuture([]);
    setState(next);
  }
  // Push an explicit baseline into history and set a new state.
  // Use when the "before" state isn't the current React state (e.g. after a live drag).
  function pushHistoryFrom(baseline: EditorState, next: EditorState) {
    setHistory((h) => [...h.slice(-29), baseline]);
    setFuture([]);
    setState(next);
  }
  function undo() {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [state, ...f]);
      setState(prev);
      return h.slice(0, -1);
    });
  }
  function redo() {
    setFuture((f) => {
      if (!f.length) return f;
      const [n, ...rest] = f;
      setHistory((h) => [...h, state]);
      setState(n);
      return rest;
    });
  }

  function pointAt(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function hitTest(p: { x: number; y: number }): Layer | null {
    // iterate top-most first
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const l = state.layers[i];
      if (insideLayer(l, p)) return l;
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = pointAt(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (tool === "select") {
      const hit = hitTest(p);
      setSelectedId(hit?.id ?? null);
      if (hit) {
        commitBaselineRef.current = state;
        lastPointRef.current = p;
        dragLiveRef.current = { id: hit.id, dx: 0, dy: 0 };
      }
      return;
    }
    if (tool === "draw") {
      drawingRef.current = { id: uid(), kind: "stroke", x: 0, y: 0, rotation: 0, scale: 1, color, thickness, points: [p] };
      scheduleRedraw();
      return;
    }
    if (tool === "rect") {
      drawingRef.current = { id: uid(), kind: "rect", x: p.x, y: p.y, w: 0, h: 0, rotation: 0, scale: 1, color, thickness, fill: false };
      scheduleRedraw();
      return;
    }
    if (tool === "circle") {
      drawingRef.current = { id: uid(), kind: "circle", x: p.x, y: p.y, r: 0, rotation: 0, scale: 1, color, thickness, fill: false };
      scheduleRedraw();
      return;
    }
    if (tool === "text") {
      setTextPrompt({ open: true, x: p.x, y: p.y, value: "" });
      return;
    }
    if (tool === "emoji") {
      const l: Layer = { id: uid(), kind: "emoji", x: p.x, y: p.y, rotation: 0, scale: 1, color, emoji, size: textSize + 8 };
      pushHistory({ ...state, layers: [...state.layers, l] });
      setSelectedId(l.id);
      return;
    }
    if (tool === "arrow") {
      const l: Layer = { id: uid(), kind: "arrow", x: p.x, y: p.y, rotation: 0, scale: 1, color, dir: arrowDir, size: 80, thickness };
      pushHistory({ ...state, layers: [...state.layers, l] });
      setSelectedId(l.id);
      return;
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = pointAt(e);
    const drag = dragLiveRef.current;
    if (drag && tool === "select") {
      const last = lastPointRef.current; if (!last) return;
      drag.dx += p.x - last.x;
      drag.dy += p.y - last.y;
      lastPointRef.current = p;
      scheduleRedraw();
      return;
    }
    const d = drawingRef.current;
    if (d) {
      if (d.kind === "stroke") {
        // mutate in place — no React state churn
        d.points.push(p);
      } else if (d.kind === "rect") {
        d.w = p.x - d.x; d.h = p.y - d.y;
      } else if (d.kind === "circle") {
        d.r = Math.hypot(p.x - d.x, p.y - d.y);
      }
      scheduleRedraw();
    }
  }

  function onPointerUp() {
    const drag = dragLiveRef.current;
    if (drag) {
      // Apply the accumulated drag delta to state once, with the pre-drag snapshot in history.
      const baseline = commitBaselineRef.current;
      const moved: EditorState = {
        ...state,
        layers: state.layers.map((l) => {
          if (l.id !== drag.id) return l;
          if (l.kind === "stroke") {
            return { ...l, points: l.points.map((pt) => ({ x: pt.x + drag.dx, y: pt.y + drag.dy })) };
          }
          return { ...l, x: l.x + drag.dx, y: l.y + drag.dy } as Layer;
        }),
      };
      if (baseline && (drag.dx !== 0 || drag.dy !== 0)) {
        pushHistoryFrom(baseline, moved);
      }
      commitBaselineRef.current = null;
      lastPointRef.current = null;
      dragLiveRef.current = null;
      scheduleRedraw();
      return;
    }
    const drawing = drawingRef.current;
    if (drawing) {
      // Normalize rect/circle so subsequent drag/hit-test behave correctly.
      let final = drawing;
      if (final.kind === "rect") {
        const x = Math.min(final.x, final.x + final.w);
        const y = Math.min(final.y, final.y + final.h);
        final = { ...final, x, y, w: Math.abs(final.w), h: Math.abs(final.h) };
        // skip zero-size shapes
        if (final.w < 2 && final.h < 2) { drawingRef.current = null; scheduleRedraw(); return; }
      } else if (final.kind === "circle") {
        if (final.r < 2) { drawingRef.current = null; scheduleRedraw(); return; }
      } else if (final.kind === "stroke") {
        if (final.points.length < 2) { drawingRef.current = null; scheduleRedraw(); return; }
      }
      pushHistory({ ...state, layers: [...state.layers, final] });
      setSelectedId(final.id);
      drawingRef.current = null;
    }
  }

  function patchSelected(patch: Partial<Layer>) {
    if (!selectedId) return;
    pushHistory({ ...state, layers: state.layers.map((l) => (l.id === selectedId ? ({ ...l, ...patch } as Layer) : l)) });
  }
  // Live patch without flooding history. Captures baseline on first call,
  // then on commitLivePatch() pushes a single history entry.
  function liveBeginIfNeeded() {
    if (!commitBaselineRef.current) commitBaselineRef.current = state;
  }
  function livePatchSelected(patch: Partial<Layer>) {
    if (!selectedId) return;
    liveBeginIfNeeded();
    setState((s) => ({ ...s, layers: s.layers.map((l) => (l.id === selectedId ? ({ ...l, ...patch } as Layer) : l)) }));
  }
  function commitLivePatch() {
    const baseline = commitBaselineRef.current;
    if (baseline && baseline !== state) {
      setHistory((h) => [...h.slice(-29), baseline]);
      setFuture([]);
    }
    commitBaselineRef.current = null;
  }
  function removeSelected() {
    if (!selectedId) return;
    pushHistory({ ...state, layers: state.layers.filter((l) => l.id !== selectedId) });
    setSelectedId(null);
  }
  // dir = +1 means bring forward (visually higher / later in z-order),
  // dir = -1 means send backward (earlier in z-order).
  function moveOrder(dir: 1 | -1) {
    if (!selectedId) return;
    const i = state.layers.findIndex((l) => l.id === selectedId);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= state.layers.length) return;
    const next = [...state.layers];
    [next[i], next[j]] = [next[j], next[i]];
    pushHistory({ ...state, layers: next });
  }
  function duplicate() {
    if (!selectedId) return;
    const l = state.layers.find((x) => x.id === selectedId);
    if (!l) return;
    const copy = { ...l, id: uid(), x: l.x + 20, y: l.y + 20 } as Layer;
    pushHistory({ ...state, layers: [...state.layers, copy] });
    setSelectedId(copy.id);
  }

  async function exportImage() {
    if (!img) return;
    // render at original resolution
    const rotated = state.rotation === 90 || state.rotation === 270;
    const outW = rotated ? img.height : img.width;
    const outH = rotated ? img.width : img.height;
    const cvs = document.createElement("canvas");
    cvs.width = outW; cvs.height = outH;
    const ctx = cvs.getContext("2d")!;
    if (exportBg === "white") {
      // Fill white background so transparent PNGs don't export as black on JPEG
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outW, outH);
    }
    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate((state.rotation * Math.PI) / 180);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
    // scale layers from view → output
    const sx = outW / view.w, sy = outH / view.h;
    ctx.save();
    ctx.scale(sx, sy);
    for (const layer of state.layers) drawLayer(ctx, layer, false);
    ctx.restore();
    // Transparent export must use PNG to preserve alpha; white export keeps smaller JPEG.
    const mime = exportBg === "transparent" ? "image/png" : "image/jpeg";
    const quality = exportBg === "transparent" ? undefined : 0.88;
    let dataUrl = "";
    let blob: Blob | null = null;
    try {
      dataUrl = cvs.toDataURL(mime, quality);
      blob = await new Promise<Blob | null>((r) => cvs.toBlob(r, mime, quality));
    } catch {
      setSavePreview({ open: false, dataUrl: "", blob: null, building: false });
      alert("Gagal menyiapkan pratinjau. Foto mungkin diblokir oleh kebijakan CORS.");
      return;
    }
    setSavePreview({ open: true, dataUrl, blob, building: false });
  }

  function openSavePreview() {
    setSavePreview({ open: true, dataUrl: "", blob: null, building: true });
    // Defer to next tick so the dialog can show its loading state first.
    setTimeout(() => { void exportImage(); }, 0);
  }

  function confirmSave() {
    if (!savePreview.blob || !savePreview.dataUrl) return;
    onSave(savePreview.blob, savePreview.dataUrl);
    setSavePreview({ open: false, dataUrl: "", blob: null, building: false });
  }

  const selected = state.layers.find((l) => l.id === selectedId);

  function commitText() {
    const text = textPrompt.value.trim();
    if (text) {
      const l: Layer = {
        id: uid(), kind: "text", x: textPrompt.x, y: textPrompt.y,
        rotation: 0, scale: 1, color, text, size: textSize, bold: true,
      };
      pushHistory({ ...state, layers: [...state.layers, l] });
      setSelectedId(l.id);
    }
    setTextPrompt((s) => ({ ...s, open: false, value: "" }));
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <button onClick={onCancel} className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-sm">
          <X className="h-4 w-4" /> Batal
        </button>
        <div className="flex items-center gap-1">
          <button onClick={undo} disabled={!history.length} className="inline-flex h-9 w-9 items-center justify-center rounded-md border disabled:opacity-40"><Undo2 className="h-4 w-4" /></button>
          <button onClick={redo} disabled={!future.length} className="inline-flex h-9 w-9 items-center justify-center rounded-md border disabled:opacity-40"><Redo2 className="h-4 w-4" /></button>
          <button onClick={() => pushHistory({ ...state, rotation: (((state.rotation + 90) % 360) as 0 | 90 | 180 | 270) })} className="inline-flex h-9 w-9 items-center justify-center rounded-md border"><RotateCw className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Latar saat ekspor"
            className="flex h-9 items-center rounded-md border p-0.5 text-xs"
          >
            <button
              type="button"
              role="radio"
              aria-checked={exportBg === "white"}
              onClick={() => setExportBg("white")}
              title="Ekspor JPEG dengan latar putih"
              className={`flex h-8 items-center gap-1 rounded px-2 ${exportBg === "white" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              <span className="inline-block h-3 w-3 rounded-sm border bg-white" />
              Putih
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={exportBg === "transparent"}
              onClick={() => setExportBg("transparent")}
              title="Ekspor PNG dengan latar transparan"
              className={`flex h-8 items-center gap-1 rounded px-2 ${exportBg === "transparent" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              <span
                className="inline-block h-3 w-3 rounded-sm border"
                style={{
                  backgroundImage:
                    "linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)",
                  backgroundSize: "6px 6px",
                  backgroundPosition: "0 0,0 3px,3px -3px,-3px 0",
                }}
              />
              Transparan
            </button>
          </div>
          <button onClick={openSavePreview} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">
            <Check className="h-4 w-4" /> Simpan
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="flex flex-1 items-center justify-center overflow-hidden bg-black/80 p-2">
        {img && view.w > 0 ? (
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="touch-none rounded shadow-lg"
          />
        ) : loadState === "error" ? (
          <div className="flex max-w-xs flex-col items-center gap-2 rounded-md bg-background/95 p-4 text-center text-sm">
            <X className="h-6 w-6 text-destructive" />
            <div className="font-medium">Gagal memuat foto</div>
            <p className="text-xs text-muted-foreground">
              Periksa koneksi internet lalu coba lagi, atau batalkan dan pilih foto lain.
            </p>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  // re-trigger the loader effect by bumping the src cache buster
                  setLoadState("loading");
                  const i = new Image();
                  i.onload = () => { imgRef.current = i; setImg(i); setLoadState("ready"); };
                  i.onerror = () => setLoadState("error");
                  i.src = src + (src.includes("?") ? "&" : "?") + "r=" + Date.now();
                }}
                className="rounded-md border px-3 py-1 text-xs"
              >
                Coba lagi
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border px-3 py-1 text-xs"
              >
                Batal
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-xs text-white/80">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <span>Memuat foto…</span>
          </div>
        )}
      </div>

      {/* Tool options bar */}
      <div className="border-t bg-card px-2 py-2 text-xs">
        {/* Color + thickness row */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {COLORS.map((c) => (
            <button key={c} onClick={() => {
                setColor(c);
                if (selected) { liveBeginIfNeeded(); livePatchSelected({ color: c } as Partial<Layer>); commitLivePatch(); }
              }}
              style={{ background: c }}
              className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-primary" : "border-transparent"}`} />
          ))}
          <label className="ml-auto flex items-center gap-1">Ukuran
            <input
              type="range" min={2} max={30} value={thickness}
              onPointerDown={() => { if (selected && "thickness" in (selected as object)) liveBeginIfNeeded(); }}
              onChange={(e) => {
                const v = Number(e.target.value); setThickness(v);
                if (selected && "thickness" in (selected as object)) livePatchSelected({ thickness: v } as Partial<Layer>);
              }}
              onPointerUp={commitLivePatch}
              onBlur={commitLivePatch}
            />
            <span className="w-6 text-right tabular-nums">{thickness}</span>
          </label>
        </div>

        {tool === "arrow" && (
          <div className="mb-2 flex flex-wrap gap-1">
            {([
              ["up", ArrowUp], ["down", ArrowDown], ["left", ArrowLeft], ["right", ArrowRight],
              ["upleft", ArrowUpLeft], ["upright", ArrowUpRight], ["downleft", ArrowDownLeft], ["downright", ArrowDownRight],
            ] as const).map(([d, Ico]) => (
              <button key={d} onClick={() => {
                  setArrowDir(d);
                  if (selected?.kind === "arrow") { liveBeginIfNeeded(); livePatchSelected({ dir: d } as Partial<Layer>); commitLivePatch(); }
                }}
                className={`inline-flex h-8 w-8 items-center justify-center rounded border ${arrowDir === d ? "border-primary bg-primary/10" : ""}`}>
                <Ico className="h-4 w-4" />
              </button>
            ))}
          </div>
        )}
        {tool === "emoji" && (
          <div className="mb-2 flex flex-wrap gap-1">
            {EMOJIS.map((em) => (
              <button key={em} onClick={() => {
                  setEmoji(em);
                  if (selected?.kind === "emoji") { liveBeginIfNeeded(); livePatchSelected({ emoji: em } as Partial<Layer>); commitLivePatch(); }
                }}
                className={`h-9 w-9 rounded border text-lg ${emoji === em ? "border-primary bg-primary/10" : ""}`}>{em}</button>
            ))}
          </div>
        )}
        {tool === "text" && (
          <div className="mb-2 flex items-center gap-2">
            <label className="flex items-center gap-1">Font
              <input
                type="range" min={14} max={96} value={textSize}
                onPointerDown={() => { if (selected?.kind === "text") liveBeginIfNeeded(); }}
                onChange={(e) => {
                  const v = Number(e.target.value); setTextSize(v);
                  if (selected?.kind === "text") livePatchSelected({ size: v } as Partial<Layer>);
                }}
                onPointerUp={commitLivePatch}
                onBlur={commitLivePatch}
              />
              <span className="w-8 text-right tabular-nums">{textSize}</span>
            </label>
          </div>
        )}

        {/* Tools bar */}
        <div className="flex flex-wrap items-center gap-1">
          <ToolBtn active={tool === "select"} onClick={() => setTool("select")} icon={<Pencil className="h-4 w-4 rotate-180" />} label="Pilih" />
          <ToolBtn active={tool === "draw"} onClick={() => setTool("draw")} icon={<Pencil className="h-4 w-4" />} label="Coret" />
          <ToolBtn active={tool === "text"} onClick={() => setTool("text")} icon={<Type className="h-4 w-4" />} label="Teks" />
          <ToolBtn active={tool === "emoji"} onClick={() => setTool("emoji")} icon={<Smile className="h-4 w-4" />} label="Stiker" />
          <ToolBtn active={tool === "arrow"} onClick={() => setTool("arrow")} icon={<ArrowRight className="h-4 w-4" />} label="Panah" />
          <ToolBtn active={tool === "rect"} onClick={() => setTool("rect")} icon={<Square className="h-4 w-4" />} label="Kotak" />
          <ToolBtn active={tool === "circle"} onClick={() => setTool("circle")} icon={<Circle className="h-4 w-4" />} label="Lingkaran" />
          {selected && (
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => moveOrder(-1)} title="Turunkan lapisan" className="inline-flex h-8 w-8 items-center justify-center rounded border"><MoveDown className="h-4 w-4" /></button>
              <button onClick={() => moveOrder(1)} title="Naikkan lapisan" className="inline-flex h-8 w-8 items-center justify-center rounded border"><MoveUp className="h-4 w-4" /></button>
              <button onClick={duplicate} title="Duplikat" className="inline-flex h-8 w-8 items-center justify-center rounded border"><CopyIcon className="h-4 w-4" /></button>
              <button onClick={removeSelected} title="Hapus" className="inline-flex h-8 w-8 items-center justify-center rounded border text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={textPrompt.open} onOpenChange={(o) => !o && setTextPrompt((s) => ({ ...s, open: false }))}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tambahkan Teks</DialogTitle>
            <DialogDescription>Tulis teks yang ingin ditampilkan pada foto.</DialogDescription>
          </DialogHeader>
          <button
            type="button"
            onClick={() => { setZoomLevel(1); setPreviewZoom(true); }}
            className="flex w-full items-center gap-3 rounded-md border bg-muted/40 p-2 text-left transition hover:bg-muted"
          >
            <img
              src={src}
              alt="Pratinjau foto"
              className="h-14 w-14 flex-shrink-0 rounded object-cover"
            />
            <div className="min-w-0 flex-1 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">Pratinjau foto</div>
              <div className="truncate">Ketuk untuk memperbesar pratinjau.</div>
            </div>
            <ZoomIn className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          </button>
          <Input
            autoFocus
            value={textPrompt.value}
            onChange={(e) => setTextPrompt((s) => ({ ...s, value: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitText(); } }}
            placeholder="Contoh: PROMO"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTextPrompt((s) => ({ ...s, open: false, value: "" }))}>Batal</Button>
            <Button onClick={commitText} disabled={!textPrompt.value.trim()}>Tambah</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={previewZoom}
        onOpenChange={(o) => { setPreviewZoom(o); if (!o) setPreviewFullscreen(false); }}
      >
        <DialogContent
          className={
            previewFullscreen
              ? "h-screen w-screen max-w-none rounded-none border-0 p-3 sm:max-w-none"
              : "max-w-[95vw] p-3 sm:max-w-2xl"
          }
        >
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 pr-6">
              <span>Pratinjau Foto</span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPreviewFullscreen((v) => !v)}
                aria-label={previewFullscreen ? "Keluar layar penuh" : "Layar penuh"}
                title={previewFullscreen ? "Keluar layar penuh" : "Layar penuh"}
              >
                {previewFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
            </DialogTitle>
            <DialogDescription>Cubit atau gunakan tombol untuk memperbesar.</DialogDescription>
          </DialogHeader>
          <div
            className={
              previewFullscreen
                ? "relative flex-1 cursor-grab touch-none overflow-auto rounded-md bg-black/80 active:cursor-grabbing"
                : "relative max-h-[70vh] cursor-grab touch-none overflow-auto rounded-md bg-black/80 active:cursor-grabbing"
            }
            ref={previewScrollRef}
            onPointerDown={onPreviewPointerDown}
            onPointerMove={onPreviewPointerMove}
            onPointerUp={onPreviewPointerUp}
            onPointerCancel={onPreviewPointerUp}
          >
            <img
              src={src}
              alt="Pratinjau foto besar"
              style={{ transform: `scale(${zoomLevel})`, transformOrigin: "top left" }}
              className="pointer-events-none block w-full select-none transition-transform"
              draggable={false}
            />
          </div>
          <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setZoomLevel((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                disabled={zoomLevel <= 0.5}
                aria-label="Perkecil"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoomLevel * 100)}%</span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setZoomLevel((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
                disabled={zoomLevel >= 4}
                aria-label="Perbesar"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setZoomLevel(1)}>Reset</Button>
            </div>
            <Button onClick={() => setPreviewZoom(false)}>Tutup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={savePreview.open}
        onOpenChange={(o) => { if (!o) setSavePreview({ open: false, dataUrl: "", blob: null, building: false }); }}
      >
        <DialogContent className="max-w-[95vw] p-3 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Pratinjau Hasil</DialogTitle>
            <DialogDescription>
              Periksa hasil edit. Jika sudah benar, tekan Simpan; atau Kembali untuk mengubah.
            </DialogDescription>
          </DialogHeader>
          <div
            className="relative max-h-[60vh] overflow-auto rounded-md p-2"
            style={
              exportBg === "transparent"
                ? {
                    backgroundImage:
                      "linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)",
                    backgroundSize: "16px 16px",
                    backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
                  }
                : { background: "#f3f4f6" }
            }
          >
            {savePreview.building || !savePreview.dataUrl ? (
              <div className="flex h-48 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                <span>Menyiapkan pratinjau…</span>
              </div>
            ) : (
              <img
                src={savePreview.dataUrl}
                alt="Pratinjau hasil edit"
                className="mx-auto block max-h-[58vh] w-auto select-none"
                draggable={false}
              />
            )}
          </div>
          <DialogFooter className="flex-row justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setSavePreview({ open: false, dataUrl: "", blob: null, building: false })}
            >
              Kembali
            </Button>
            <Button onClick={confirmSave} disabled={!savePreview.blob || savePreview.building}>
              <Check className="mr-1 h-4 w-4" /> Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>,
    document.body,
  );
}

function ToolBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] ${active ? "border-primary bg-primary/10" : ""}`}>
      {icon}<span>{label}</span>
    </button>
  );
}

function insideLayer(l: Layer, p: { x: number; y: number }): boolean {
  if (l.kind === "text") {
    const w = (l.text.length * l.size) * 0.6, h = l.size * 1.2;
    return p.x >= l.x - 6 && p.x <= l.x + w + 6 && p.y >= l.y - h && p.y <= l.y + 6;
  }
  if (l.kind === "emoji") {
    return p.x >= l.x - l.size / 2 && p.x <= l.x + l.size / 2 && p.y >= l.y - l.size / 2 && p.y <= l.y + l.size / 2;
  }
  if (l.kind === "arrow") {
    const s = l.size; return p.x >= l.x - s / 2 && p.x <= l.x + s / 2 && p.y >= l.y - s / 2 && p.y <= l.y + s / 2;
  }
  if (l.kind === "rect") {
    const x1 = Math.min(l.x, l.x + l.w), x2 = Math.max(l.x, l.x + l.w);
    const y1 = Math.min(l.y, l.y + l.h), y2 = Math.max(l.y, l.y + l.h);
    return p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
  }
  if (l.kind === "circle") {
    return Math.hypot(p.x - l.x, p.y - l.y) <= l.r + 6;
  }
  if (l.kind === "stroke") {
    for (const pt of l.points) if (Math.hypot(pt.x - p.x, pt.y - p.y) < l.thickness + 6) return true;
  }
  return false;
}

function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, selected: boolean) {
  ctx.save();
  ctx.strokeStyle = l.color; ctx.fillStyle = l.color;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (l.kind === "stroke") {
    ctx.lineWidth = l.thickness; ctx.beginPath();
    l.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  } else if (l.kind === "text") {
    ctx.font = `${l.bold ? "bold " : ""}${l.size}px system-ui, sans-serif`;
    ctx.textBaseline = "alphabetic";
    // outline for readability
    ctx.lineWidth = Math.max(3, l.size / 12); ctx.strokeStyle = l.color === "#ffffff" ? "#000" : "#fff";
    ctx.strokeText(l.text, l.x, l.y);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.x, l.y);
  } else if (l.kind === "emoji") {
    ctx.font = `${l.size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(l.emoji, l.x, l.y);
  } else if (l.kind === "arrow") {
    drawArrow(ctx, l.x, l.y, l.size, l.dir, l.thickness, l.color);
  } else if (l.kind === "rect") {
    ctx.lineWidth = l.thickness;
    if (l.fill) ctx.fillRect(l.x, l.y, l.w, l.h);
    ctx.strokeRect(l.x, l.y, l.w, l.h);
  } else if (l.kind === "circle") {
    ctx.lineWidth = l.thickness; ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2);
    if (l.fill) ctx.fill();
    ctx.stroke();
  }
  if (selected) {
    ctx.strokeStyle = "#3b82f6"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    const b = layerBox(l);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  }
  ctx.restore();
}

function layerBox(l: Layer): { x: number; y: number; w: number; h: number } {
  if (l.kind === "text") return { x: l.x - 4, y: l.y - l.size, w: l.text.length * l.size * 0.6 + 8, h: l.size * 1.2 };
  if (l.kind === "emoji") return { x: l.x - l.size / 2, y: l.y - l.size / 2, w: l.size, h: l.size };
  if (l.kind === "arrow") return { x: l.x - l.size / 2, y: l.y - l.size / 2, w: l.size, h: l.size };
  if (l.kind === "rect") return { x: Math.min(l.x, l.x + l.w), y: Math.min(l.y, l.y + l.h), w: Math.abs(l.w), h: Math.abs(l.h) };
  if (l.kind === "circle") return { x: l.x - l.r, y: l.y - l.r, w: l.r * 2, h: l.r * 2 };
  // stroke
  const xs = l.points.map((p) => p.x), ys = l.points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function drawArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, dir: ArrowDir, thickness: number, color: string) {
  const angles: Record<ArrowDir, number> = {
    right: 0, downright: 45, down: 90, downleft: 135, left: 180, upleft: 225, up: 270, upright: 315,
  };
  const a = (angles[dir] * Math.PI) / 180;
  const len = size;
  const tipX = cx + Math.cos(a) * len / 2, tipY = cy + Math.sin(a) * len / 2;
  const tailX = cx - Math.cos(a) * len / 2, tailY = cy - Math.sin(a) * len / 2;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = thickness; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(tipX, tipY); ctx.stroke();
  // arrow head
  const headLen = Math.max(thickness * 3, size * 0.25);
  const headA = Math.PI / 6;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - headLen * Math.cos(a - headA), tipY - headLen * Math.sin(a - headA));
  ctx.lineTo(tipX - headLen * Math.cos(a + headA), tipY - headLen * Math.sin(a + headA));
  ctx.closePath();
  ctx.fill();
}