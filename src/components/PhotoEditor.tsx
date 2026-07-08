import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight,
  Type, Eraser, Undo2, Redo2, RotateCw, Square, Circle, Pencil, Trash2,
  X, Check, Smile, MoveUp, MoveDown, Copy as CopyIcon, ZoomIn, ZoomOut, Maximize2, Minimize2,
  Loader2, AlertTriangle, RefreshCw, ClipboardCopy, ClipboardCheck,
  Download, HelpCircle,
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
import { editorFeedback } from "@/lib/editor-feedback";
import { useVisualViewportKeyboardInset } from "@/hooks/use-visual-viewport-inset";
import { useScrollShadow } from "@/hooks/use-scroll-shadow";

export type LayerBase = { id: string; x: number; y: number; rotation: number; scale: number; color: string; opacity: number };
export type ArrowDir = "up" | "down" | "left" | "right" | "upleft" | "upright" | "downleft" | "downright";
export type Layer =
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

const TOOL_LABELS: Record<Tool, string> = {
  select: "Pilih",
  draw: "Coret",
  text: "Teks",
  emoji: "Stiker",
  arrow: "Panah",
  rect: "Kotak",
  circle: "Lingkaran",
};

const TOOL_HINTS: Record<Tool, string> = {
  select: "Ketuk objek untuk memilih, seret untuk memindahkan",
  draw: "Seret jari di kanvas untuk menggambar bebas",
  text: "Ketuk kanvas atau tombol Tambah teks untuk menulis",
  emoji: "Pilih emoji lalu ketuk untuk menempelkan di tengah",
  arrow: "Pilih arah panah, otomatis tempel di tengah kanvas",
  rect: "Seret untuk ukuran bebas, atau ketuk untuk kotak default",
  circle: "Seret dari pusat ke tepi, atau ketuk untuk ukuran default",
};

const TOOL_SHORTCUTS: Record<Tool, string | null> = {
  select: "P",
  draw: "C",
  text: "T",
  emoji: "S",
  arrow: "A",
  rect: "K",
  circle: "L",
};

const KEY_TO_TOOL: Record<string, Tool> = Object.fromEntries(
  Object.entries(TOOL_SHORTCUTS)
    .filter(([, k]) => k !== null)
    .map(([t, k]) => [k!.toLowerCase(), t as Tool])
);

// Tools that show a detailed guide modal on first use or after a long absence.
const GUIDED_TOOLS: Tool[] = ["text", "emoji", "draw"];
// Consider a tool "new / returning" if it hasn't been used in this many days.
const GUIDE_RETURN_DAYS = 7;
const GUIDE_STORAGE_KEY = "photo-editor-tool-guide";

type GuideSeenMap = Partial<Record<Tool, number>>;

const TOOL_GUIDES: Record<Tool, { title: string; steps: string[]; tip: string } | null> = {
  select: null,
  draw: {
    title: "Panduan Coret",
    steps: [
      "Pilih tool Coret (C) di toolbar.",
      "Seret jari / mouse di kanvas untuk menggambar garis bebas.",
      "Ketuk sekali bila hanya ingin membuat titik coretan.",
      "Gunakan slider Ukuran di bawah untuk mengatur ketebalan coretan.",
    ],
    tip: "Coretan langsung tersimpan sebagai lapisan; gunakan Undo bila ingin membatalkan.",
  },
  text: {
    title: "Panduan Teks",
    steps: [
      "Pilih tool Teks (T) di toolbar.",
      "Ketuk kanvas di posisi yang diinginkan, atau tekan tombol Tambah teks di tengah.",
      "Ketik teks di jendela yang muncul, lalu tekan OK.",
      "Setelah teks muncul, ketuk untuk memilih lalu seret untuk memindahkan.",
    ],
    tip: "Slider Ukuran mengubah font; tombol B membuat teks menjadi tebal.",
  },
  emoji: {
    title: "Panduan Stiker",
    steps: [
      "Pilih tool Stiker (S) di toolbar.",
      "Pilih emoji di deretan emoji di bawah toolbar.",
      "Emoji akan menempel di tengah kanvas secara otomatis.",
      "Ketuk emoji untuk memilih, seret untuk memindahkan, atau gunakan tombol Ukuran untuk memperbesar.",
    ],
    tip: "Stiker tetap bisa dipindah dan dihapus seperti objek lain.",
  },
  arrow: null,
  rect: null,
  circle: null,
};




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
  // True once render() has actually painted the canvas at least once. Lets
  // us show "Menyiapkan kanvas…" during the brief gap between the image
  // loading and the first successful rasterisation.
  const [canvasReady, setCanvasReady] = useState(false);
  // True while exportImage is composing the final JPEG.
  const [exporting, setExporting] = useState(false);
  // Panel panduan singkat tiap tool. Disembunyikan by default agar toolbar
  // tetap padat; pengguna baru bisa tap ikon "?" untuk membacanya.
  const [helpOpen, setHelpOpen] = useState(false);
  // Modal panduan detail untuk tool Teks/Stiker/Coret saat pertama kali dipilih
  // atau setelah tidak dipakai dalam beberapa hari.
  const [guideTool, setGuideTool] = useState<Tool | null>(null);
  // Strip hint aktif bisa ditutup pengguna; akan muncul kembali saat tool berubah.
  const [hintClosedForTool, setHintClosedForTool] = useState<Tool | null>(null);

  function readGuideSeenMap(): GuideSeenMap {
    if (typeof localStorage === "undefined") return {};
    try {
      const raw = localStorage.getItem(GUIDE_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as GuideSeenMap) : {};
    } catch {
      return {};
    }
  }
  function writeGuideSeenMap(map: GuideSeenMap) {
    if (typeof localStorage === "undefined") return;
    try { localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(map)); } catch { /* noop */ }
  }
  function shouldShowGuide(t: Tool): boolean {
    if (!GUIDED_TOOLS.includes(t)) return false;
    const lastSeen = readGuideSeenMap()[t];
    if (!lastSeen) return true;
    return Date.now() - lastSeen > GUIDE_RETURN_DAYS * 24 * 60 * 60 * 1000;
  }
  function markGuideSeen(t: Tool) {
    const map = readGuideSeenMap();
    map[t] = Date.now();
    writeGuideSeenMap(map);
  }
  function closeGuide(t: Tool) {
    markGuideSeen(t);
    setGuideTool(null);
  }
  // Set to true when the user presses "Batal" while exportImage is running so
  // we can skip onSave once the async toBlob resolves.
  const exportCancelledRef = useRef(false);
  // Refs for overlay focus management — when a loading/exporting/error overlay
  // becomes active we move focus into it (so screen readers announce it and
  // keyboard users aren't stranded) and restore focus to the previously
  // focused element when the overlay closes.
  const loadingOverlayRef = useRef<HTMLDivElement | null>(null);
  const canvasLoadingOverlayRef = useRef<HTMLDivElement | null>(null);
  const exportingOverlayRef = useRef<HTMLDivElement | null>(null);
  const errorOverlayRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Track which overlay (if any) currently owns focus. When it changes, move
  // focus into the overlay and remember where it came from so we can restore
  // it after the overlay disappears.
  const activeOverlay: "loading" | "canvas" | "exporting" | "error" | null =
    loadStatus === "error"
      ? "error"
      : loadStatus === "loading"
        ? "loading"
        : exporting
          ? "exporting"
          : !canvasReady && loadStatus === "ready"
            ? "canvas"
            : null;

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!activeOverlay) {
      const prev = previousFocusRef.current;
      previousFocusRef.current = null;
      if (prev && document.contains(prev)) {
        try { prev.focus({ preventScroll: true }); } catch { /* noop */ }
      }
      return;
    }
    const target =
      activeOverlay === "loading" ? loadingOverlayRef.current
      : activeOverlay === "canvas" ? canvasLoadingOverlayRef.current
      : activeOverlay === "exporting" ? exportingOverlayRef.current
      : errorOverlayRef.current;
    if (!target) return;
    if (!previousFocusRef.current) {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body) previousFocusRef.current = active;
    }
    try { target.focus({ preventScroll: true }); } catch { /* noop */ }
  }, [activeOverlay]);

  const [state, setState] = useState<EditorState>({ layers: [], rotation: 0 });
  const [history, setHistory] = useState<EditorState[]>([]);
  const [future, setFuture] = useState<EditorState[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#ef4444");
  const [thickness, setThickness] = useState(6);
  const [opacity, setOpacity] = useState(1);
  const [shapeFill, setShapeFill] = useState(false);
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
  // Feedback halus (getar + bunyi) saat berganti tool. Skip pemuatan awal.
  const prevToolRef = useRef<Tool>(tool);
  useEffect(() => {
    if (prevToolRef.current !== tool) {
      editorFeedback.toolSwitch();
      prevToolRef.current = tool;
      // Strip hint muncul lagi untuk tool yang baru dipilih.
      setHintClosedForTool((closed) => (closed === tool ? closed : null));
      if (shouldShowGuide(tool)) {
        setGuideTool(tool);
      }
    }
  }, [tool]);
  // Keyboard shortcuts: single letter tanpa modifier, hanya bila fokus tidak
  // berada di input/textarea/select/contenteditable (mis. saat mengetik teks).
  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (isTyping(e.target)) return;
      const next = KEY_TO_TOOL[e.key.toLowerCase()];
      if (!next) return;
      e.preventDefault();
      setTool(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setTool]);

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
    setCanvasReady(false);
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
    if (base && !canvasReady) setCanvasReady(true);
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
    editorFeedback.commit();
  }
  // Push an explicit baseline into history and set a new state.
  // Use when the "before" state isn't the current React state (e.g. after a live drag).
  function pushHistoryFrom(baseline: EditorState, next: EditorState) {
    setHistory((h) => [...h.slice(-29), baseline]);
    setFuture([]);
    setState(next);
    editorFeedback.commit();
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
  function pointFromClient(clientX: number, clientY: number) {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // Pada sebagian Android WebView / Chromium mobile emulation, `pointerdown`
  // di-supress oleh browser saat `touch-action:none` + touchstart mendahului.
  // Kalau kita hanya andalkan onPointerDown, semua tool "tidak jalan" karena
  // drawingRef tidak pernah diinisialisasi (hanya pointermove/pointerup yang
  // sampai). Solusinya: dukung Touch Events juga sebagai jalur alternatif.
  //
  // Aturan agar tidak double-fire dengan pointer events pada perangkat yang
  // MEMANG mengirim keduanya: sekali touch session aktif, blokir handler
  // pointer sampai touchend/touchcancel.
  const touchDrivingRef = useRef(false);

  function hitTest(p: { x: number; y: number }): Layer | null {
    // iterate top-most first
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const l = state.layers[i];
      if (insideLayer(l, p)) return l;
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (touchDrivingRef.current) return; // touchstart already handled it
    const p = pointAt(e);
    // Beberapa Android WebView / event yang tidak sepenuhnya trusted bisa
    // melempar InvalidStateError di sini. Jangan biarkan itu membatalkan
    // pemilihan tool — capture pointer adalah optimasi, bukan syarat.
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
    handleDown(p);
  }

  function handleDown(p: { x: number; y: number }) {
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
      drawingRef.current = { id: uid(), kind: "stroke", x: 0, y: 0, rotation: 0, scale: 1, color, opacity, thickness, points: [p] };
      scheduleRedraw();
      return;
    }
    if (tool === "rect") {
      drawingRef.current = { id: uid(), kind: "rect", x: p.x, y: p.y, w: 0, h: 0, rotation: 0, scale: 1, color, opacity, thickness, fill: shapeFill };
      lastPointRef.current = p; // used to detect tap-vs-drag on release
      scheduleRedraw();
      return;
    }
    if (tool === "circle") {
      drawingRef.current = { id: uid(), kind: "circle", x: p.x, y: p.y, r: 0, rotation: 0, scale: 1, color, opacity, thickness, fill: shapeFill };
      lastPointRef.current = p;
      scheduleRedraw();
      return;
    }
    if (tool === "text") {
      setTextPrompt({ open: true, x: p.x, y: p.y, value: "" });
      return;
    }
    if (tool === "emoji") {
      const l: Layer = { id: uid(), kind: "emoji", x: p.x, y: p.y, rotation: 0, scale: 1, color, opacity, emoji, size: textSize + 8 };
      pushHistory({ ...state, layers: [...state.layers, l] });
      setSelectedId(l.id);
      return;
    }
    if (tool === "arrow") {
      const l: Layer = { id: uid(), kind: "arrow", x: p.x, y: p.y, rotation: 0, scale: 1, color, opacity, dir: arrowDir, size: 80, thickness };
      pushHistory({ ...state, layers: [...state.layers, l] });
      setSelectedId(l.id);
      return;
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (touchDrivingRef.current) return;
    const p = pointAt(e);
    handleMove(p);
  }

  function handleMove(p: { x: number; y: number }) {
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
    if (touchDrivingRef.current) return;
    handleUp();
  }

  function handleUp() {
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
        // Tap-to-place fallback: user tapped without dragging → drop a
        // sensible default-sized rectangle at the tap so the tool doesn't
        // feel broken. 96px matches typical annotation size.
        if (final.w < 4 && final.h < 4) {
          const size = 96;
          final = { ...final, x: final.x - size / 2, y: final.y - size / 2, w: size, h: size };
        }
      } else if (final.kind === "circle") {
        if (final.r < 4) final = { ...final, r: 48 };
      } else if (final.kind === "stroke") {
        // Single-tap fallback: render a small dot so the pen tool always
        // leaves a mark, then the user knows it worked.
        if (final.points.length < 2) {
          const p = final.points[0];
          final = { ...final, points: [p, { x: p.x + 0.5, y: p.y + 0.5 }] };
        }
      }
      pushHistory({ ...state, layers: [...state.layers, final] });
      setSelectedId(final.id);
      drawingRef.current = null;
      lastPointRef.current = null;
    }
  }

  // Android/webview fires pointercancel when the OS intercepts the gesture
  // (scroll, palm rejection, multi-finger, keyboard opening). Without this,
  // dragLiveRef / drawingRef stay set forever and the editor feels frozen.
  function onPointerCancel() {
    if (touchDrivingRef.current) return;
    handleCancel();
  }

  function handleCancel() {
    dragLiveRef.current = null;
    drawingRef.current = null;
    commitBaselineRef.current = null;
    lastPointRef.current = null;
    scheduleRedraw();
  }

  // Touch fallback — needed on Android WebView / mobile Chrome where
  // pointerdown is sometimes suppressed by the browser even though
  // touchstart fires normally. See probe log in Playwright harness.
  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchDrivingRef.current = true;
    // Note: React 18 touch listeners are passive; preventDefault() would
    // no-op with a console warning. CSS `touch-action: none` on the canvas
    // already blocks browser gestures, so no preventDefault is needed.
    handleDown(pointFromClient(t.clientX, t.clientY));
  }
  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    if (!touchDrivingRef.current) return;
    const t = e.touches[0]; if (!t) return;
    handleMove(pointFromClient(t.clientX, t.clientY));
  }
  function onTouchEnd(e: React.TouchEvent<HTMLCanvasElement>) {
    if (!touchDrivingRef.current) return;
    handleUp();
    // release after the microtask so pointer events fired by browser as
    // a compat shim are ignored (they would double-commit otherwise).
    setTimeout(() => { touchDrivingRef.current = false; }, 0);
  }
  function onTouchCancel() {
    if (!touchDrivingRef.current) return;
    handleCancel();
    setTimeout(() => { touchDrivingRef.current = false; }, 0);
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
    exportCancelledRef.current = false;
    setExporting(true);
    try {
      const result = await composeExport(0.88);
      if (!result || exportCancelledRef.current) return;
      onSave(result.blob, result.dataUrl);
    } finally {
      setExporting(false);
      exportCancelledRef.current = false;
    }
  }

  // Kompos ulang JPEG hasil edit di resolusi asli foto. Dipakai bersama oleh
  // "Simpan" (menyerahkan blob ke aplikasi) dan "Simpan ke galeri" (menulis
  // file ke Documents di Android / mengunduh di web). Kualitas 0.92 dipakai
  // untuk galeri agar hasil cetak/lihat ulang lebih tajam.
  async function composeExport(quality: number): Promise<{ blob: Blob; dataUrl: string } | null> {
    if (!img) return null;
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
    const sx = outW / view.w, sy = outH / view.h;
    ctx.save();
    ctx.scale(sx, sy);
    for (const layer of state.layers) drawLayer(ctx, layer, false);
    ctx.restore();
    const dataUrl = cvs.toDataURL("image/jpeg", quality);
    const blob = await new Promise<Blob | null>((r) => cvs.toBlob(r, "image/jpeg", quality));
    if (!blob) return null;
    return { blob, dataUrl };
  }

  // Simpan hasil edit ke galeri/berkas perangkat. Di Android (Capacitor) file
  // ditulis ke folder Documents/MCM Storage supaya mudah ditemukan lewat
  // aplikasi Files bawaan; di web men-trigger unduhan browser.
  async function saveToGallery() {
    if (!img || exporting) return;
    setExporting(true);
    try {
      const result = await composeExport(0.92);
      if (!result) {
        toast.error("Gagal menyiapkan gambar untuk disimpan.");
        return;
      }
      const ts = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
      const filename = `mcm-foto-${stamp}.jpg`;

      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        try {
          const { Filesystem, Directory } = await import("@capacitor/filesystem");
          const buf = await result.blob.arrayBuffer();
          // base64 encode via chunks (menghindari stack overflow di file besar)
          const bytes = new Uint8Array(buf);
          let bin = "";
          const CHUNK = 0x8000;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
          }
          const b64 = btoa(bin);
          await Filesystem.writeFile({
            path: `MCM Storage/${filename}`,
            data: b64,
            directory: Directory.Documents,
            recursive: true,
          });
          toast.success("Foto tersimpan", {
            description: `Documents › MCM Storage › ${filename}`,
          });
          return;
        } catch (err) {
          console.error("saveToGallery native failed", err);
          toast.error("Gagal menyimpan ke galeri perangkat.");
          return;
        }
      }

      // Web: unduh via <a download>.
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Foto diunduh", { description: filename });
    } finally {
      setExporting(false);
    }
  }

  const selected = state.layers.find((l) => l.id === selectedId);

  function commitText() {
    const text = textPrompt.value.trim();
    if (text) {
      const l: Layer = {
        id: uid(), kind: "text", x: textPrompt.x, y: textPrompt.y,
        rotation: 0, scale: 1, color, opacity, text, size: textSize, bold: true,
      };
      pushHistory({ ...state, layers: [...state.layers, l] });
      setSelectedId(l.id);
    }
    setTextPrompt((s) => ({ ...s, open: false, value: "" }));
  }

  if (typeof document === "undefined") return null;
  // Sisi bawah editor bisa tertutup soft-keyboard (dialog Teks) atau
  // ter-clip saat toolbar browser Android muncul. Hook ini melacak
  // selisih visualViewport vs layoutViewport dan diaplikasikan ke:
  //   - `bottom` root (`fixed inset-x-0 top-0` + `bottom: kbInset`) →
  //     seluruh editor terangkat di atas keyboard, jadi tombol
  //     Batal/Simpan/Coret dst. tetap dalam viewport
  //   - `paddingBottom` panel tool options → agar env(safe-area-inset)
  //     tetap dihormati saat kbInset = 0 (safe area device fisik).
  const kbInset = useVisualViewportKeyboardInset();
  // Ref + hook untuk indikator scroll pada panel opsi bawah. Panel ini
  // dibatasi `max-h-[55vh]` sehingga tombol tool dapat ter-scroll ke luar
  // pandangan pada layar sempit; user perlu tahu ke arah mana harus
  // menggulir untuk mencapai tombol.
  const toolPanelRef = useRef<HTMLDivElement | null>(null);
  const { topShadow, bottomShadow } = useScrollShadow(toolPanelRef);
  return (
    <div
      className="fixed inset-x-0 top-0 z-[100] flex flex-col bg-background text-foreground"
      style={{ bottom: kbInset }}
      // Stop the editor's pointerdown from reaching parent overlays (Sheet /
      // Dialog dismissal, drag-to-close sheets in the shell). MUST be the
      // bubble phase — capture-phase stopPropagation prevents pointerdown
      // from ever reaching the canvas, so tap-once tools (coret/kotak/
      // lingkaran/stiker/panah) can't init `drawingRef` and `handleUp`
      // no-ops, which broke undo/redo for single-tap actions.
      onPointerDown={(e) => e.stopPropagation()}
      aria-busy={activeOverlay !== null && activeOverlay !== "error"}
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
        <button
          onClick={exportImage}
          disabled={exporting || !canvasReady}
          className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-60"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {exporting ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          onClick={saveToGallery}
          disabled={exporting || !canvasReady}
          title="Simpan salinan ke galeri / unduhan perangkat"
          aria-label="Simpan ke galeri"
          className="inline-flex h-9 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-3 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Ke galeri</span>
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
              onPointerCancel={onPointerCancel}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchCancel}
              className="absolute inset-0 touch-none"
              style={{ width: `${view.w}px`, height: `${view.h}px` }}
            />
            {!canvasReady && (
              <div
                ref={canvasLoadingOverlayRef}
                role="status"
                aria-live="polite"
                aria-atomic="true"
                aria-label="Menyiapkan kanvas"
                tabIndex={-1}
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 text-foreground backdrop-blur-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Loader2 className="h-7 w-7 animate-spin" />
                <div className="text-xs font-medium">Menyiapkan kanvas…</div>
                <div className="text-[11px] text-muted-foreground">
                  Foto sudah dimuat. Sedang dirasterisasi ke kanvas.
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={onCancel}
                >
                  <X className="mr-1 h-3.5 w-3.5" /> Batal
                </Button>
              </div>
            )}
            {canvasReady && tool !== "select" && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/90 px-2.5 py-1 text-[11px] font-medium text-primary-foreground shadow-md"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground/70 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-foreground" />
                </span>
                {tool === "draw" && <span>Coret aktif — seret jari di kanvas</span>}
                {tool === "text" && <span>Teks aktif — ketuk kanvas untuk menempel</span>}
                {tool === "emoji" && <span>Stiker aktif — pilih emoji atau ketuk kanvas</span>}
                {tool === "arrow" && <span>Panah aktif — pilih arah atau ketuk kanvas</span>}
                {tool === "rect" && <span>Kotak aktif — seret atau ketuk kanvas</span>}
                {tool === "circle" && <span>Lingkaran aktif — seret atau ketuk kanvas</span>}
              </div>
            )}
            {exporting && (
              <div
                ref={exportingOverlayRef}
                role="status"
                aria-live="polite"
                aria-atomic="true"
                aria-label="Menyimpan foto"
                tabIndex={-1}
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 text-foreground backdrop-blur-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <div className="text-xs font-medium">Menyimpan foto…</div>
                <div className="text-[11px] text-muted-foreground">
                  Menggabungkan coretan ke resolusi asli.
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    exportCancelledRef.current = true;
                    setExporting(false);
                    toast.info("Penyimpanan dibatalkan. Anda bisa lanjut mengedit.");
                  }}
                >
                  <X className="mr-1 h-3.5 w-3.5" /> Batal
                </Button>
              </div>
            )}
          </div>
        )}
        {loadStatus === "loading" && (
          <div
            ref={loadingOverlayRef}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label="Memuat foto"
            tabIndex={-1}
            className="flex flex-col items-center gap-3 text-center text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md p-2"
          >
            <Loader2 className="h-8 w-8 animate-spin" />
            <div className="text-sm font-medium">Memuat foto…</div>
            <div className="text-xs text-muted-foreground">
              {srcKind(src) === "http"
                ? "Mengunduh dari server. Periksa koneksi bila terasa lama."
                : srcKind(src) === "blob"
                  ? "Membaca foto dari memori perangkat…"
                  : "Mendekode foto. File besar bisa butuh beberapa detik."}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-1"
              onClick={onCancel}
            >
              <X className="mr-1 h-3.5 w-3.5" /> Batal
            </Button>
          </div>
        )}
        {loadStatus === "error" && (
          <div
            ref={errorOverlayRef}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            tabIndex={-1}
            className="mx-3 max-w-sm rounded-lg border border-destructive/50 bg-background/95 p-4 text-left shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      {/*
        Panel opsi tool. Dilengkapi:
          - gradient fade atas/bawah yang muncul otomatis saat masih ada
            tombol di luar pandangan → user tahu perlu men-scroll.
          - `aria-busy` + spinner kecil saat kanvas belum siap → tombol
            tool dinonaktifkan sampai kanvas mount, tidak silent-fail.
      */}
      <div className="relative">
        {topShadow && (
          <div
            aria-hidden
            data-testid="tool-panel-shadow-top"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-card to-transparent"
          />
        )}
        {bottomShadow && (
          <div
            aria-hidden
            data-testid="tool-panel-shadow-bottom"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-card to-transparent"
          />
        )}
      <div
        ref={toolPanelRef}
        data-scroll-shadow={
          topShadow && bottomShadow ? "both" : topShadow ? "top" : bottomShadow ? "bottom" : "none"
        }
        aria-busy={!canvasReady && loadStatus === "ready"}
        className="max-h-[55vh] overflow-y-auto border-t bg-card px-2 py-2 text-xs shadow-sm"
        style={{
          paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
        }}
      >
        {!canvasReady && loadStatus === "ready" && (
          <div
            role="status"
            aria-live="polite"
            data-testid="tool-panel-loading"
            className="mb-2 flex items-center gap-2 rounded-md border border-muted-foreground/20 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Menyiapkan kanvas — tombol siap sebentar lagi.</span>
          </div>
        )}
        {/* Color + thickness row */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Warna:</span>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setColor(c);
                if (selected) { liveBeginIfNeeded(); livePatchSelected({ color: c } as Partial<Layer>); commitLivePatch(); }
              }}
              title={`Pilih warna ${c}`}
              aria-label={`Pilih warna ${c}`}
              style={{ background: c }}
              className={`h-6 w-6 rounded-full border-2 transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${color === c ? "border-primary" : "border-transparent"}`}
            />
          ))}
          <label
            className="ml-auto flex items-center gap-1"
            title="Ketebalan garis untuk coret, panah, kotak, dan lingkaran"
          >
            <span>Ketebalan</span>
            <input
              type="range"
              min={2}
              max={30}
              value={thickness}
              title="Ketebalan garis (2–30 px)"
              aria-label="Ketebalan garis dari 2 sampai 30 piksel"
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
          <label
            className="flex items-center gap-1"
            title="Transparansi lapisan (10%–100%)"
          >
            <span>Opacity</span>
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(opacity * 100)}
              title="Transparansi lapisan (10%–100%)"
              aria-label="Transparansi lapisan dari 10 sampai 100 persen"
              onPointerDown={() => { if (selected) liveBeginIfNeeded(); }}
              onChange={(e) => {
                const v = Number(e.target.value) / 100; setOpacity(v);
                if (selected) livePatchSelected({ opacity: v } as Partial<Layer>);
              }}
              onPointerUp={commitLivePatch}
              onBlur={commitLivePatch}
            />
            <span className="w-8 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
          </label>
        </div>

        {(tool === "rect" || tool === "circle") && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Mode:</span>
            <button
              type="button"
              onClick={() => {
                const next = !shapeFill;
                setShapeFill(next);
                if (selected && (selected.kind === "rect" || selected.kind === "circle")) {
                  liveBeginIfNeeded();
                  livePatchSelected({ fill: next } as Partial<Layer>);
                  commitLivePatch();
                }
              }}
              title={shapeFill ? "Mode isi: bentuk akan diisi penuh" : "Mode garis: hanya tepi bentuk yang terlihat"}
              aria-label={shapeFill ? "Mode isi aktif, ketuk untuk beralih ke mode garis" : "Mode garis aktif, ketuk untuk beralih ke mode isi"}
              className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${shapeFill ? "border-primary bg-primary/10 text-primary" : "border-input bg-background"}`}
            >
              {shapeFill ? "Isi" : "Garis"}
            </button>
            <span className="text-muted-foreground">
              {shapeFill ? "Bentuk diisi penuh" : "Hanya tepi bentuk"}
            </span>
          </div>
        )}

        {tool === "arrow" && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Arah:</span>
            {([
              ["up", ArrowUp, "Atas"], ["down", ArrowDown, "Bawah"], ["left", ArrowLeft, "Kiri"], ["right", ArrowRight, "Kanan"],
              ["upleft", ArrowUpLeft, "Kiri atas"], ["upright", ArrowUpRight, "Kanan atas"], ["downleft", ArrowDownLeft, "Kiri bawah"], ["downright", ArrowDownRight, "Kanan bawah"],
            ] as const).map(([d, Ico, label]) => (
              <button
                key={d}
                type="button"
                title={`Arah panah ${label}`}
                aria-label={`Pilih arah panah ${label}`}
                onClick={() => {
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
                      rotation: 0, scale: 1, color, opacity, dir: d, size: 80, thickness,
                    };
                    pushHistory({ ...state, layers: [...state.layers, l] });
                    setSelectedId(l.id);
                  }
                }}
                className={`inline-flex h-8 w-8 items-center justify-center rounded border bg-background transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${arrowDir === d ? "border-primary bg-primary/10" : ""}`}>
                <Ico className="h-4 w-4" />
              </button>
            ))}
          </div>
        )}
        {tool === "emoji" && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Stiker:</span>
            <div className="flex flex-wrap gap-1">
              {EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  title={`Stiker ${em}`}
                  aria-label={`Pilih stiker ${em}`}
                  onClick={() => {
                    setEmoji(em);
                    if (selected?.kind === "emoji") {
                      liveBeginIfNeeded();
                      livePatchSelected({ emoji: em } as Partial<Layer>);
                      commitLivePatch();
                    } else {
                      // Konsisten dengan tombol Panah: langsung tempelkan
                      // stiker di tengah kanvas — user tidak perlu menebak
                      // bahwa harus tap kanvas dulu.
                      const v = viewRef.current;
                      const cx = v.w ? v.w / 2 : 100;
                      const cy = v.h ? v.h / 2 : 100;
                      const l: Layer = {
                        id: uid(), kind: "emoji", x: cx, y: cy,
                        rotation: 0, scale: 1, color, opacity, emoji: em, size: textSize + 8,
                      };
                      pushHistory({ ...state, layers: [...state.layers, l] });
                      setSelectedId(l.id);
                    }
                  }}
                  className={`h-9 w-9 rounded border bg-background text-lg transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${emoji === em ? "border-primary bg-primary/10" : ""}`}>{em}</button>
              ))}
            </div>
          </div>
        )}
        {tool === "text" && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              title="Tambahkan teks baru di tengah kanvas"
              aria-label="Tambahkan teks baru di tengah kanvas"
              onClick={() => {
                const v = viewRef.current;
                const cx = v.w ? v.w / 2 : 100;
                const cy = v.h ? v.h / 2 : 100;
                setTextPrompt({ open: true, x: cx, y: cy, value: "" });
              }}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-primary bg-primary/10 px-2 text-[11px] font-medium transition hover:bg-primary/20"
            >
              <Type className="h-3.5 w-3.5" /> Tambah teks di tengah
            </button>
            <label
              className="flex items-center gap-1"
              title="Ukuran font teks (14–96 px)"
            >
              <span>Ukuran font</span>
              <input
                type="range"
                min={14}
                max={96}
                value={textSize}
                title="Ukuran font teks (14–96 px)"
                aria-label="Ukuran font teks dari 14 sampai 96 piksel"
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

        {/* Screen-reader-only active tool status */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {TOOL_LABELS[tool]} aktif. {TOOL_HINTS[tool]}
        </div>

        {/* Active tool hint */}
        {hintClosedForTool !== tool && (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="mb-2 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] pr-1"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70 opacity-75" />
              <span className="relative inline-flex h-full w-2 rounded-full bg-primary" />
            </span>
            <span className="font-medium text-primary">
              {TOOL_SHORTCUTS[tool] ? `${TOOL_LABELS[tool]} (${TOOL_SHORTCUTS[tool]})` : TOOL_LABELS[tool]} aktif
            </span>
            <span className="text-muted-foreground">— {TOOL_HINTS[tool]}</span>
            <button
              type="button"
              onClick={() => setHintClosedForTool(tool)}
              title="Tutup petunjuk sampai tool berubah"
              aria-label="Tutup petunjuk sampai tool berubah"
              className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Tools bar */}
        <div
          role="toolbar"
          aria-label="Toolbar editor foto"
          className="flex flex-wrap items-center gap-1"
        >
          <ToolBtn active={tool === "select"} onClick={() => setTool("select")} icon={<Pencil className="h-4 w-4 rotate-180" />} label="Pilih" hint="Ketuk objek untuk memilih, seret untuk memindahkan" shortcut={TOOL_SHORTCUTS.select} />
          <ToolBtn active={tool === "draw"} onClick={() => setTool("draw")} icon={<Pencil className="h-4 w-4" />} label="Coret" hint="Seret jari di kanvas untuk menggambar bebas" shortcut={TOOL_SHORTCUTS.draw} />
          <ToolBtn active={tool === "text"} onClick={() => setTool("text")} icon={<Type className="h-4 w-4" />} label="Teks" hint="Ketuk kanvas atau tombol Tambah teks untuk menulis" shortcut={TOOL_SHORTCUTS.text} />
          <ToolBtn active={tool === "emoji"} onClick={() => setTool("emoji")} icon={<Smile className="h-4 w-4" />} label="Stiker" hint="Pilih emoji lalu ketuk untuk menempelkan di tengah" shortcut={TOOL_SHORTCUTS.emoji} />
          <ToolBtn active={tool === "arrow"} onClick={() => setTool("arrow")} icon={<ArrowRight className="h-4 w-4" />} label="Panah" hint="Pilih arah panah, otomatis tempel di tengah kanvas" shortcut={TOOL_SHORTCUTS.arrow} />
          <ToolBtn active={tool === "rect"} onClick={() => setTool("rect")} icon={<Square className="h-4 w-4" />} label="Kotak" hint="Seret untuk ukuran bebas, atau ketuk untuk kotak default" shortcut={TOOL_SHORTCUTS.rect} />
          <ToolBtn active={tool === "circle"} onClick={() => setTool("circle")} icon={<Circle className="h-4 w-4" />} label="Lingkaran" hint="Seret dari pusat ke tepi, atau ketuk untuk ukuran default" shortcut={TOOL_SHORTCUTS.circle} />
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            title="Panduan singkat tiap tool"
            aria-label="Panduan singkat tiap tool"
            aria-expanded={helpOpen}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${helpOpen ? "border-primary bg-primary/10 text-primary" : ""}`}
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          {selected && (
            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => moveOrder(-1)} title="Turunkan lapisan" className="inline-flex h-8 w-8 items-center justify-center rounded border bg-background transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><MoveDown className="h-4 w-4" /></button>
              <button type="button" onClick={() => moveOrder(1)} title="Naikkan lapisan" className="inline-flex h-8 w-8 items-center justify-center rounded border bg-background transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><MoveUp className="h-4 w-4" /></button>
              <button type="button" onClick={duplicate} title="Duplikat" className="inline-flex h-8 w-8 items-center justify-center rounded border bg-background transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><CopyIcon className="h-4 w-4" /></button>
              <button type="button" onClick={removeSelected} title="Hapus" className="inline-flex h-8 w-8 items-center justify-center rounded border bg-background text-destructive transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><Trash2 className="h-4 w-4" /></button>
            </div>
          )}
        </div>
        {helpOpen && (
          <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-[11px] leading-snug">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold text-primary">Panduan singkat</span>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                tutup
              </button>
            </div>
            <ul className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
              <li><b>Pilih:</b> ketuk objek untuk memilih, seret untuk memindahkan.</li>
              <li><b>Coret:</b> seret jari di kanvas — ketuk saja menghasilkan titik.</li>
              <li><b>Teks:</b> ketuk kanvas / tombol “Tambah teks di tengah”, tulis, lalu OK.</li>
              <li><b>Stiker:</b> pilih emoji di panel — otomatis menempel di tengah.</li>
              <li><b>Panah:</b> pilih arah 8 mata angin — otomatis tempel; ubah arah lagi untuk yang terpilih.</li>
              <li><b>Kotak / Lingkaran:</b> seret di kanvas untuk ukuran bebas, atau ketuk sekali untuk ukuran standar.</li>
            </ul>
            <div className="mt-1 text-muted-foreground">
              Pintasan keyboard: {Object.entries(TOOL_SHORTCUTS).map(([t, k]) => k && `${k} ${TOOL_LABELS[t as Tool]}`).filter(Boolean).join(", ")}.
            </div>
            <div className="mt-1 text-muted-foreground">Semua objek bisa dipilih ulang → geser, duplikat, atau hapus lewat ikon di kanan.</div>
          </div>
        )}
      </div>

      {/* Detailed first-use / returning guide modal for Teks/Stiker/Coret */}
      {guideTool && TOOL_GUIDES[guideTool] && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) closeGuide(guideTool);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{TOOL_GUIDES[guideTool]!.title}</DialogTitle>
              <DialogDescription>
                Panduan muncul saat pertama kali memilih tool ini atau setelah tidak dipakai {GUIDE_RETURN_DAYS} hari.
              </DialogDescription>
            </DialogHeader>
            <ol className="my-2 list-decimal space-y-1.5 pl-5 text-sm text-foreground">
              {TOOL_GUIDES[guideTool]!.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs text-primary">
              <span className="font-semibold">Tip:</span>{" "}
              {TOOL_GUIDES[guideTool]!.tip}
            </div>
            <DialogFooter>
              <Button onClick={() => closeGuide(guideTool)}>
                <Check className="mr-1 h-4 w-4" /> Mengerti
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

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

function ToolBtn({
  active, onClick, icon, label, hint, shortcut,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint?: string; shortcut?: string | null;
}) {
  // `title` memberi tooltip native saat hover (desktop) dan long-press (Android/iOS).
  // `aria-label` menambahkan konteks untuk pembaca layar, termasuk pintasan keyboard.
  const suffix = shortcut ? ` (${shortcut})` : "";
  const display = `${label}${suffix}`;
  const aria = hint ? `${display} — ${hint}` : display;
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint ? `${display}: ${hint}` : display}
      aria-label={aria}
      aria-keyshortcuts={shortcut ?? undefined}
      aria-pressed={active}
      data-testid={`photo-editor-tool-${label.toLowerCase()}`}
      data-photo-editor-tool={label}
      className={`inline-flex h-8 min-w-11 items-center gap-1 rounded-md border bg-background px-2 text-[11px] transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${active ? "border-primary bg-primary/10" : ""}`}
    >
      {icon}<span>{label}</span>
    </button>
  );
}

// Ambang tap yang MURAH-HATI di jari mobile. Angka ini adalah radius ekstra
// (CSS px, sama dengan koordinat kanvas di komponen ini) di sekitar geometri
// nyata setiap layer. Tanpa ambang ini, objek tipis seperti panah 6 px atau
// coretan hampir mustahil di-select di ponsel — pengguna melapor "tidak
// bisa disentuh semua".
const HIT_PAD = 14;

// Jarak titik ke segmen garis A–B. Dipakai untuk uji-tap panah & coretan
// supaya tidak perlu tap tepat di titik pusat.
function pointSegDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const apx = p.x - a.x, apy = p.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(apx, apy);
  let t = (apx * abx + apy * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx, cy = a.y + t * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}

function arrowEndpoints(l: Extract<Layer, { kind: "arrow" }>): {
  tail: { x: number; y: number }; tip: { x: number; y: number };
} {
  const angles: Record<ArrowDir, number> = {
    right: 0, downright: 45, down: 90, downleft: 135,
    left: 180, upleft: 225, up: 270, upright: 315,
  };
  const a = (angles[l.dir] * Math.PI) / 180;
  const half = l.size / 2;
  return {
    tail: { x: l.x - Math.cos(a) * half, y: l.y - Math.sin(a) * half },
    tip:  { x: l.x + Math.cos(a) * half, y: l.y + Math.sin(a) * half },
  };
}

export function insideLayer(l: Layer, p: { x: number; y: number }): boolean {
  if (l.kind === "text") {
    // Perkiraan lebar teks: font system-ui rata-rata ~0.6em per karakter.
    // Tinggi mengikuti baseline ke atas + sedikit descender.
    const w = (l.text.length * l.size) * 0.6, h = l.size * 1.2;
    return p.x >= l.x - HIT_PAD && p.x <= l.x + w + HIT_PAD
        && p.y >= l.y - h - HIT_PAD && p.y <= l.y + HIT_PAD;
  }
  if (l.kind === "emoji") {
    const s = l.size / 2 + HIT_PAD;
    return p.x >= l.x - s && p.x <= l.x + s && p.y >= l.y - s && p.y <= l.y + s;
  }
  if (l.kind === "arrow") {
    // Uji jarak ke SEGMEN panah (ekor→ujung), bukan bounding-box centered.
    // Tanpa ini, tap di tengah shaft panah tipis sering meleset karena
    // bbox hanya `size × size` di sekitar (l.x, l.y).
    const { tail, tip } = arrowEndpoints(l as Extract<Layer, { kind: "arrow" }>);
    return pointSegDist(p, tail, tip) <= (l.thickness / 2) + HIT_PAD;
  }
  if (l.kind === "rect") {
    const x1 = Math.min(l.x, l.x + l.w) - HIT_PAD;
    const x2 = Math.max(l.x, l.x + l.w) + HIT_PAD;
    const y1 = Math.min(l.y, l.y + l.h) - HIT_PAD;
    const y2 = Math.max(l.y, l.y + l.h) + HIT_PAD;
    return p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
  }
  if (l.kind === "circle") {
    return Math.hypot(p.x - l.x, p.y - l.y) <= l.r + HIT_PAD;
  }
  if (l.kind === "stroke") {
    // Uji jarak ke setiap segmen coretan — bukan hanya titik-titik sampel.
    // Ambang = setengah ketebalan + HIT_PAD supaya coretan tipis pun
    // bisa di-tap tanpa harus tepat di atas garis.
    const tol = l.thickness / 2 + HIT_PAD;
    const pts = l.points;
    if (pts.length === 1) return Math.hypot(pts[0].x - p.x, pts[0].y - p.y) <= tol;
    for (let i = 1; i < pts.length; i++) {
      if (pointSegDist(p, pts[i - 1], pts[i]) <= tol) return true;
    }
  }
  return false;
}

function drawLayer(ctx: CanvasRenderingContext2D, l: Layer, selected: boolean) {
  ctx.save();
  ctx.globalAlpha = l.opacity ?? 1;
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