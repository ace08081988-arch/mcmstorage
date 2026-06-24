import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight,
  Type, Eraser, Undo2, Redo2, RotateCw, Square, Circle, Pencil, Trash2,
  X, Check, Smile, MoveUp, MoveDown, Copy as CopyIcon, ZoomIn, ZoomOut, Maximize2, Minimize2,
  Loader2, AlertTriangle, RefreshCw, ClipboardCopy, ClipboardCheck,
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
import { toast } from "sonner";

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
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<{
    title: string;
    reason: string;
    nextSteps: string[];
    technical: string;
  } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [copiedError, setCopiedError] = useState(false);

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
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null);

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

  // Identify the kind of URL we received so the error can name it.
  function srcKind(s: string): "data" | "blob" | "http" | "file" | "other" {
    if (/^data:/i.test(s)) return "data";
    if (/^blob:/i.test(s)) return "blob";
    if (/^https?:\/\//i.test(s)) return "http";
    if (/^file:/i.test(s)) return "file";
    return "other";
  }
  function srcSummary(s: string): string {
    const kind = srcKind(s);
    if (kind === "data") {
      const m = s.match(/^data:([^;,]+)(;base64)?,/i);
      const mime = m?.[1] ?? "unknown";
      // approx byte length for base64 payload
      const payload = s.slice(s.indexOf(",") + 1);
      const bytes = m?.[2]
        ? Math.floor((payload.length * 3) / 4)
        : payload.length;
      const kb = Math.round(bytes / 1024);
      return `data: URL (${mime}, ~${kb} KB)`;
    }
    if (kind === "blob") return `blob: URL (${s.slice(0, 48)}…)`;
    if (kind === "http") {
      try {
        const u = new URL(s);
        return `${u.protocol}//${u.host}${u.pathname}`;
      } catch {
        return s.slice(0, 80);
      }
    }
    return s.slice(0, 80);
  }

  // Load image
  useEffect(() => {
    setLoadStatus("loading");
    setLoadError(null);
    setImg(null);
    baseCanvasRef.current = null;
    const i = new Image();
    // Jangan paksa crossOrigin untuk data: / blob: URL — di sebagian browser
    // Android Chrome/WebView ini membuat image gagal load secara senyap
    // sehingga kanvas tidak pernah dirender (terlihat sebagai foto "gelap").
    if (/^https?:\/\//i.test(src)) i.crossOrigin = "anonymous";
    let cancelled = false;
    const startedAt = Date.now();
    const kind = srcKind(src);
    const summary = srcSummary(src);
    const timeoutId = window.setTimeout(() => {
      if (cancelled || loadStatus === "ready") return;
      setLoadStatus((s) => (s === "loading" ? "error" : s));
      setLoadError({
        title: "Waktu memuat foto habis (timeout)",
        reason:
          kind === "http"
            ? "Foto tidak selesai diunduh dalam 20 detik. Koneksi internet kemungkinan lambat atau server gambar tidak merespons."
            : kind === "blob"
              ? "Browser tidak menyelesaikan pembacaan blob foto dalam 20 detik. Blob mungkin sudah dibebaskan (URL.revokeObjectURL) atau memori penuh."
              : "Browser tidak selesai mendekode foto dalam 20 detik. File mungkin terlalu besar untuk perangkat ini.",
        nextSteps: [
          "Periksa koneksi internet, lalu tekan ‘Coba lagi’.",
          "Coba foto yang ukurannya lebih kecil (< 5 MB).",
          kind === "blob"
            ? "Tutup editor, lalu pilih ulang foto dari galeri (blob lama mungkin sudah kedaluwarsa)."
            : "Restart aplikasi bila masalah berulang.",
        ],
        technical: `kind=${kind} • ${summary} • timeout 20s`,
      });
    }, 20000);
    i.onload = () => {
      if (cancelled) return;
      window.clearTimeout(timeoutId);
      if (!i.width || !i.height) {
        setLoadStatus("error");
        setLoadError({
          title: "File foto rusak atau kosong",
          reason:
            "Foto berhasil diunduh tetapi dimensi gambar 0×0 piksel. File kemungkinan rusak, terpotong, atau formatnya tidak didukung browser.",
          nextSteps: [
            "Pilih foto lain dari galeri.",
            "Pastikan format JPG/PNG/WebP (HEIC tidak didukung di sebagian browser).",
            "Jika foto baru saja difoto, coba ulangi pengambilan foto.",
          ],
          technical: `kind=${kind} • ${summary} • naturalSize=0x0`,
        });
        return;
      }
      imgRef.current = i;
      setImg(i);
      setLoadStatus("ready");
    };
    i.onerror = () => {
      if (cancelled) return;
      window.clearTimeout(timeoutId);
      const elapsed = Date.now() - startedAt;
      console.error("PhotoEditor: gagal memuat gambar", { kind, summary, elapsed });
      setLoadStatus("error");
      setLoadError({
        title:
          kind === "blob"
            ? "Blob foto tidak bisa dibaca"
            : kind === "data"
              ? "Data foto tidak bisa didekode"
              : kind === "http"
                ? "Foto gagal diunduh dari server"
                : "Foto gagal dimuat",
        reason:
          kind === "blob"
            ? "URL blob sudah tidak valid — biasanya karena dipanggil URL.revokeObjectURL, halaman direfresh, atau file aslinya sudah dihapus dari memori."
            : kind === "data"
              ? "String data: URL tidak bisa didekode browser. File mungkin rusak, base64 terpotong, atau MIME type tidak didukung."
              : kind === "http"
                ? "Permintaan ke server gagal: koneksi terputus, foto sudah dihapus, atau diblokir CORS."
                : "Browser menolak memuat foto. Format mungkin tidak didukung atau file rusak.",
        nextSteps:
          kind === "blob"
            ? [
                "Tutup editor lalu pilih ulang foto dari galeri.",
                "Jangan menutup dialog asal foto sebelum editor terbuka.",
              ]
            : kind === "data"
              ? [
                  "Pilih ulang foto dari galeri.",
                  "Gunakan format JPG atau PNG yang lebih umum.",
                ]
              : kind === "http"
                ? [
                    "Periksa koneksi internet, lalu tekan ‘Coba lagi’.",
                    "Buka URL foto di tab baru untuk memastikan masih ada.",
                  ]
                : [
                    "Pilih foto lain.",
                    "Pastikan format JPG/PNG/WebP.",
                  ],
        technical: `kind=${kind} • ${summary} • elapsed=${elapsed}ms`,
      });
    };
    try {
      i.src = src;
    } catch (err) {
      window.clearTimeout(timeoutId);
      setLoadStatus("error");
      setLoadError({
        title: "URL foto tidak valid",
        reason:
          "Browser menolak nilai src yang diberikan: " +
          (err instanceof Error ? err.message : String(err)),
        nextSteps: ["Tutup editor lalu pilih ulang foto."],
        technical: `kind=${kind} • ${summary}`,
      });
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      i.onload = null;
      i.onerror = null;
    };
  }, [src, loadAttempt]);

  // Compute view size based on container width
  useEffect(() => {
    if (!img || !wrapRef.current) return;
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      const containerW = el.clientWidth;
      if (!containerW) return; // tunggu sampai layout punya lebar
      const containerH = Math.min(window.innerHeight - 240, 560);
      const ratio = img.width / img.height;
      const rotated = state.rotation === 90 || state.rotation === 270;
      const baseW = rotated ? img.height : img.width;
      const baseH = rotated ? img.width : img.height;
      const r = baseW / baseH;
      let w = containerW, h = containerW / r;
      if (h > containerH) { h = containerH; w = h * r; }
      setView({ w, h });
    };
    update();
    window.addEventListener("resize", update);
    // ResizeObserver supaya view juga terhitung saat lebar container
    // berubah karena keyboard mobile / rotasi / animasi mount.
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => update())
      : null;
    if (ro && wrapRef.current) ro.observe(wrapRef.current);
    return () => {
      window.removeEventListener("resize", update);
      ro?.disconnect();
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
    try {
      ctx.save();
      ctx.translate(view.w / 2, view.h / 2);
      ctx.rotate((state.rotation * Math.PI) / 180);
      const rotated = state.rotation === 90 || state.rotation === 270;
      const dw = rotated ? view.h : view.w;
      const dh = rotated ? view.w : view.h;
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      baseCanvasRef.current = base;
    } catch (err) {
      // Some mobile WebViews can decode <img> but fail to rasterise it to canvas.
      // Keep the editor usable by showing the DOM image fallback behind the canvas.
      console.error("PhotoEditor: gagal merender base canvas", err);
      baseCanvasRef.current = null;
    }
    // Synchronous render — matches the redraw-effect below and avoids the
    // StrictMode rAF-jam described there.
    render();
  }, [img, view, state.rotation]);

  // Composite layer pass — copies cached base then draws layers + in-progress shape.
  function render() {
    const cvs = canvasRef.current;
    const base = baseCanvasRef.current;
    const v = viewRef.current;
    if (!cvs || !v.w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(v.w * dpr), H = Math.round(v.h * dpr);
    if (cvs.width !== W || cvs.height !== H) {
      cvs.width = W; cvs.height = H;
      cvs.style.width = `${v.w}px`; cvs.style.height = `${v.h}px`;
    }
    const ctx = cvs.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (base) ctx.drawImage(base, 0, 0);
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
  // Call render() synchronously here — this effect only fires on real state
  // changes (not on every pointermove) so rAF coalescing isn't needed, and
  // a synchronous call sidesteps a StrictMode bug where the unmount cleanup
  // cancels the queued rAF but leaves `rafIdRef` pointing at the cancelled
  // id, which then permanently jams every subsequent `scheduleRedraw()`.
  useEffect(() => { render(); }, [state, view, selectedId]);
  useEffect(() => () => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null; // critical: cancelAnimationFrame does NOT null the id
    }
  }, []);

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
    const dataUrl = cvs.toDataURL("image/jpeg", 0.88);
    const blob: Blob | null = await new Promise((r) => cvs.toBlob(r, "image/jpeg", 0.88));
    if (blob) onSave(blob, dataUrl);
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
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-background text-foreground"
      onPointerDownCapture={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 border-b bg-card px-3 py-2 shadow-sm">
        <button onClick={onCancel} className="inline-flex h-9 items-center gap-1 rounded-md border bg-background px-3 text-sm transition hover:bg-muted">
          <X className="h-4 w-4" /> Batal
        </button>
        <div className="flex items-center gap-1">
          <button onClick={undo} disabled={!history.length} className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background transition hover:bg-muted disabled:opacity-40"><Undo2 className="h-4 w-4" /></button>
          <button onClick={redo} disabled={!future.length} className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background transition hover:bg-muted disabled:opacity-40"><Redo2 className="h-4 w-4" /></button>
          <button onClick={() => pushHistory({ ...state, rotation: (((state.rotation + 90) % 360) as 0 | 90 | 180 | 270) })} className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background transition hover:bg-muted"><RotateCw className="h-4 w-4" /></button>
        </div>
        <button onClick={exportImage} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">
          <Check className="h-4 w-4" /> Simpan
        </button>
      </div>

      <div ref={wrapRef} className="flex flex-1 items-center justify-center overflow-hidden bg-muted p-2">
        {img && view.w > 0 && loadStatus === "ready" && (
          <div
            className="relative overflow-hidden rounded shadow-lg"
            style={{ width: `${view.w}px`, height: `${view.h}px` }}
          >
            <img
              src={src}
              alt="Foto yang sedang diedit"
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
            />
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="absolute inset-0 touch-none"
              style={{ width: `${view.w}px`, height: `${view.h}px` }}
            />
          </div>
        )}
        {loadStatus === "loading" && (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-3 text-center text-foreground"
          >
            <Loader2 className="h-8 w-8 animate-spin" />
            <div className="text-sm font-medium">Memuat foto…</div>
            <div className="text-xs text-muted-foreground">Mohon tunggu sebentar.</div>
          </div>
        )}
        {loadStatus === "error" && (
          <div
            role="alert"
            className="mx-3 max-w-sm rounded-lg border border-destructive/50 bg-background/95 p-4 text-left shadow-lg"
          >
            <div className="mb-2 flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
              <div className="text-sm font-semibold text-foreground">
                {loadError?.title ?? "Foto gagal ditampilkan"}
              </div>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              {loadError?.reason ?? "Terjadi kesalahan saat memuat foto."}
            </p>
            {loadError?.nextSteps && loadError.nextSteps.length > 0 && (
              <div className="mb-3">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
                  Langkah berikutnya
                </div>
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                  {loadError.nextSteps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
            {loadError?.technical && (
              <details className="mb-3 rounded border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
                <summary className="cursor-pointer select-none font-medium">
                  Detail teknis
                </summary>
                <code className="mt-1 block break-all font-mono text-[10px]">
                  {loadError.technical}
                </code>
              </details>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const lines = [
                    `Judul: ${loadError?.title ?? "-"}`,
                    `Penyebab: ${loadError?.reason ?? "-"}`,
                    loadError?.nextSteps?.length
                      ? `Langkah berikutnya:\n- ${loadError.nextSteps.join("\n- ")}`
                      : "",
                    `Detail teknis: ${loadError?.technical ?? "-"}`,
                    `User agent: ${typeof navigator !== "undefined" ? navigator.userAgent : "-"}`,
                    `Waktu: ${new Date().toISOString()}`,
                  ].filter(Boolean).join("\n");
                  try {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(lines);
                    } else {
                      const ta = document.createElement("textarea");
                      ta.value = lines;
                      ta.style.position = "fixed";
                      ta.style.opacity = "0";
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand("copy");
                      document.body.removeChild(ta);
                    }
                    setCopiedError(true);
                    toast.success("Detail error disalin ke clipboard");
                    setTimeout(() => setCopiedError(false), 2000);
                  } catch {
                    toast.error("Gagal menyalin. Salin manual dari Detail teknis.");
                  }
                }}
              >
                {copiedError ? (
                  <><ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Tersalin</>
                ) : (
                  <><ClipboardCopy className="mr-1 h-3.5 w-3.5" /> Salin detail error</>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLoadAttempt((n) => n + 1)}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Coba lagi
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Batal
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Tool options bar */}
      <div className="border-t bg-card px-2 py-2 text-xs shadow-sm">
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
              <button key={d} type="button" onClick={() => {
                  setArrowDir(d);
                  if (selected?.kind === "arrow") {
                    // Sedang ada panah terpilih → cukup ubah arahnya.
                    liveBeginIfNeeded();
                    livePatchSelected({ dir: d } as Partial<Layer>);
                    commitLivePatch();
                  } else {
                    // Tempelkan stiker panah baru di tengah kanvas (seperti stiker).
                    const v = viewRef.current;
                    const cx = v.w ? v.w / 2 : 100;
                    const cy = v.h ? v.h / 2 : 100;
                    const l: Layer = {
                      id: uid(), kind: "arrow", x: cx, y: cy,
                      rotation: 0, scale: 1, color, dir: d, size: 80, thickness,
                    };
                    pushHistory({ ...state, layers: [...state.layers, l] });
                    setSelectedId(l.id);
                  }
                }}
                className={`inline-flex h-8 w-8 items-center justify-center rounded border bg-background transition hover:bg-muted ${arrowDir === d ? "border-primary bg-primary/10" : ""}`}>
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
                className={`h-9 w-9 rounded border bg-background text-lg transition hover:bg-muted ${emoji === em ? "border-primary bg-primary/10" : ""}`}>{em}</button>
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
              <button onClick={() => moveOrder(-1)} title="Turunkan lapisan" className="inline-flex h-8 w-8 items-center justify-center rounded border bg-background transition hover:bg-muted"><MoveDown className="h-4 w-4" /></button>
              <button onClick={() => moveOrder(1)} title="Naikkan lapisan" className="inline-flex h-8 w-8 items-center justify-center rounded border bg-background transition hover:bg-muted"><MoveUp className="h-4 w-4" /></button>
              <button onClick={duplicate} title="Duplikat" className="inline-flex h-8 w-8 items-center justify-center rounded border bg-background transition hover:bg-muted"><CopyIcon className="h-4 w-4" /></button>
              <button onClick={removeSelected} title="Hapus" className="inline-flex h-8 w-8 items-center justify-center rounded border bg-background text-destructive transition hover:bg-muted"><Trash2 className="h-4 w-4" /></button>
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
                ? "relative flex-1 cursor-grab touch-none overflow-auto rounded-md bg-muted active:cursor-grabbing"
                : "relative max-h-[70vh] cursor-grab touch-none overflow-auto rounded-md bg-muted active:cursor-grabbing"
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
    </div>
  );
}

function ToolBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={`inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2 text-[11px] transition hover:bg-muted ${active ? "border-primary bg-primary/10" : ""}`}>
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