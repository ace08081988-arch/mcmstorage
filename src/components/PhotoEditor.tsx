import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight,
  Type, Eraser, Undo2, Redo2, RotateCw, Square, Circle, Pencil, Trash2,
  X, Check, Smile, MoveUp, MoveDown, Copy as CopyIcon,
} from "lucide-react";

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
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [drawing, setDrawing] = useState<Layer | null>(null);

  // Load image
  useEffect(() => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => { setImg(i); imgRef.current = i; };
    i.src = src;
  }, [src]);

  // Compute view size based on container width
  useEffect(() => {
    if (!img || !wrapRef.current) return;
    const update = () => {
      const containerW = wrapRef.current!.clientWidth;
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
    return () => window.removeEventListener("resize", update);
  }, [img, state.rotation]);

  // Draw
  useEffect(() => {
    const cvs = canvasRef.current; if (!cvs || !img || !view.w) return;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = view.w * dpr; cvs.height = view.h * dpr;
    cvs.style.width = `${view.w}px`; cvs.style.height = `${view.h}px`;
    const ctx = cvs.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);

    // base image with rotation
    ctx.save();
    ctx.translate(view.w / 2, view.h / 2);
    ctx.rotate((state.rotation * Math.PI) / 180);
    const rotated = state.rotation === 90 || state.rotation === 270;
    const dw = rotated ? view.h : view.w;
    const dh = rotated ? view.w : view.h;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    for (const layer of state.layers) drawLayer(ctx, layer, selectedId === layer.id);
    if (drawing) drawLayer(ctx, drawing, false);
  }, [img, view, state, drawing, selectedId]);

  function pushHistory(next: EditorState) {
    setHistory((h) => [...h.slice(-29), state]);
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
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === "select") {
      const hit = hitTest(p);
      setSelectedId(hit?.id ?? null);
      if (hit) setDrag({ id: hit.id, dx: p.x - hit.x, dy: p.y - hit.y });
      return;
    }
    if (tool === "draw") {
      setDrawing({ id: uid(), kind: "stroke", x: 0, y: 0, rotation: 0, scale: 1, color, thickness, points: [p] });
      return;
    }
    if (tool === "rect") {
      setDrawing({ id: uid(), kind: "rect", x: p.x, y: p.y, w: 0, h: 0, rotation: 0, scale: 1, color, thickness, fill: false });
      return;
    }
    if (tool === "circle") {
      setDrawing({ id: uid(), kind: "circle", x: p.x, y: p.y, r: 0, rotation: 0, scale: 1, color, thickness, fill: false });
      return;
    }
    if (tool === "text") {
      const text = window.prompt("Teks:", "");
      if (text) {
        const l: Layer = { id: uid(), kind: "text", x: p.x, y: p.y, rotation: 0, scale: 1, color, text, size: textSize, bold: true };
        pushHistory({ ...state, layers: [...state.layers, l] });
        setSelectedId(l.id);
      }
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
    if (drag && tool === "select") {
      setState((s) => ({
        ...s,
        layers: s.layers.map((l) => (l.id === drag.id ? { ...l, x: p.x - drag.dx, y: p.y - drag.dy } : l)),
      }));
      return;
    }
    if (drawing) {
      if (drawing.kind === "stroke") {
        setDrawing({ ...drawing, points: [...drawing.points, p] });
      } else if (drawing.kind === "rect") {
        setDrawing({ ...drawing, w: p.x - drawing.x, h: p.y - drawing.y });
      } else if (drawing.kind === "circle") {
        const dx = p.x - drawing.x, dy = p.y - drawing.y;
        setDrawing({ ...drawing, r: Math.hypot(dx, dy) });
      }
    }
  }

  function onPointerUp() {
    if (drag) {
      // commit drag into history (current state already mutated)
      setHistory((h) => [...h.slice(-29), { ...state }]);
      setDrag(null);
      return;
    }
    if (drawing) {
      pushHistory({ ...state, layers: [...state.layers, drawing] });
      setSelectedId(drawing.id);
      setDrawing(null);
    }
  }

  function patchSelected(patch: Partial<Layer>) {
    if (!selectedId) return;
    pushHistory({ ...state, layers: state.layers.map((l) => (l.id === selectedId ? ({ ...l, ...patch } as Layer) : l)) });
  }
  function removeSelected() {
    if (!selectedId) return;
    pushHistory({ ...state, layers: state.layers.filter((l) => l.id !== selectedId) });
    setSelectedId(null);
  }
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

  return (
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
        <button onClick={exportImage} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground">
          <Check className="h-4 w-4" /> Simpan
        </button>
      </div>

      <div ref={wrapRef} className="flex flex-1 items-center justify-center overflow-hidden bg-black/80 p-2">
        {img && view.w > 0 && (
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="touch-none rounded shadow-lg"
          />
        )}
      </div>

      {/* Tool options bar */}
      <div className="border-t bg-card px-2 py-2 text-xs">
        {/* Color + thickness row */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {COLORS.map((c) => (
            <button key={c} onClick={() => { setColor(c); if (selected) patchSelected({ color: c } as Partial<Layer>); }}
              style={{ background: c }}
              className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-primary" : "border-transparent"}`} />
          ))}
          <label className="ml-auto flex items-center gap-1">Ukuran
            <input type="range" min={2} max={30} value={thickness} onChange={(e) => { const v = Number(e.target.value); setThickness(v); if (selected && "thickness" in (selected as object)) patchSelected({ thickness: v } as Partial<Layer>); }} />
            <span className="w-6 text-right tabular-nums">{thickness}</span>
          </label>
        </div>

        {tool === "arrow" && (
          <div className="mb-2 flex flex-wrap gap-1">
            {([
              ["up", ArrowUp], ["down", ArrowDown], ["left", ArrowLeft], ["right", ArrowRight],
              ["upleft", ArrowUpLeft], ["upright", ArrowUpRight], ["downleft", ArrowDownLeft], ["downright", ArrowDownRight],
            ] as const).map(([d, Ico]) => (
              <button key={d} onClick={() => { setArrowDir(d); if (selected?.kind === "arrow") patchSelected({ dir: d } as Partial<Layer>); }}
                className={`inline-flex h-8 w-8 items-center justify-center rounded border ${arrowDir === d ? "border-primary bg-primary/10" : ""}`}>
                <Ico className="h-4 w-4" />
              </button>
            ))}
          </div>
        )}
        {tool === "emoji" && (
          <div className="mb-2 flex flex-wrap gap-1">
            {EMOJIS.map((em) => (
              <button key={em} onClick={() => { setEmoji(em); if (selected?.kind === "emoji") patchSelected({ emoji: em } as Partial<Layer>); }}
                className={`h-9 w-9 rounded border text-lg ${emoji === em ? "border-primary bg-primary/10" : ""}`}>{em}</button>
            ))}
          </div>
        )}
        {tool === "text" && (
          <div className="mb-2 flex items-center gap-2">
            <label className="flex items-center gap-1">Font
              <input type="range" min={14} max={96} value={textSize} onChange={(e) => { const v = Number(e.target.value); setTextSize(v); if (selected?.kind === "text") patchSelected({ size: v } as Partial<Layer>); }} />
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
              <button onClick={() => moveOrder(-1)} title="Ke bawah" className="inline-flex h-8 w-8 items-center justify-center rounded border"><MoveDown className="h-4 w-4" /></button>
              <button onClick={() => moveOrder(1)} title="Ke atas" className="inline-flex h-8 w-8 items-center justify-center rounded border"><MoveUp className="h-4 w-4" /></button>
              <button onClick={duplicate} title="Duplikat" className="inline-flex h-8 w-8 items-center justify-center rounded border"><CopyIcon className="h-4 w-4" /></button>
              <button onClick={removeSelected} title="Hapus" className="inline-flex h-8 w-8 items-center justify-center rounded border text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      </div>
    </div>
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