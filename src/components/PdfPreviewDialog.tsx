import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Download,
  FileWarning,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  MoveHorizontal,
  Maximize2,
} from "lucide-react";

export type PdfPreviewSource = { blob: Blob; filename: string } | null;

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source: PdfPreviewSource;
  /** Judul dialog, mis. "Pratinjau ringkasan". */
  title?: string;
  onDownloaded?: () => void;
};

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Bersihkan nama file agar aman di Android/Windows dan selalu berakhiran .pdf. */
export function sanitizePdfFilename(raw: string, fallback = "dokumen.pdf"): string {
  let name = (raw || "").trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-");
  name = name.replace(/\.pdf$/i, "").replace(/\s+/g, " ").replace(/^[.\s-]+/, "").slice(0, 120).trim();
  if (!name) return fallback;
  return `${name}.pdf`;
}

/**
 * Pratinjau PDF sebelum diunduh. Halaman dirender ke <canvas> lewat pdf.js
 * supaya tetap tampil di Android WebView (yang tidak punya viewer PDF bawaan).
 */
export function PdfPreviewDialog({ open, onOpenChange, source, title = "Pratinjau PDF", onDownloaded }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const thumbHostRef = useRef<HTMLDivElement | null>(null);
  const pageElsRef = useRef<HTMLCanvasElement[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [pages, setPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const [errMsg, setErrMsg] = useState("");
  // Nama file bisa diubah owner sebelum unduh supaya arsip di perangkat rapi.
  const [name, setName] = useState("");
  // Mode tampilan: "width" = penuhi lebar, "page" = satu halaman utuh.
  const [fit, setFit] = useState<"width" | "page">("width");
  // Rotasi baca (0/90/180/270) — hanya memengaruhi pratinjau, bukan berkas.
  const [rotation, setRotation] = useState(0);

  const render = useCallback(async (
    blob: Blob,
    host: HTMLDivElement,
    thumbHost: HTMLDivElement | null,
    fitMode: "width" | "page",
    rotate: number,
  ) => {
    setStatus("loading");
    setErrMsg("");
    try {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

      const data = new Uint8Array(await blob.arrayBuffer());
      const doc = await pdfjs.getDocument({ data }).promise;
      host.innerHTML = "";
      if (thumbHost) thumbHost.innerHTML = "";
      pageElsRef.current = [];
      setPages(doc.numPages);
      setCurrent(1);

      const hostW = host.clientWidth || 320;
      const hostH = host.clientHeight || 420;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1, rotation: rotate });
        const fitScale =
          fitMode === "page"
            ? Math.min((hostW - 16) / base.width, (hostH - 16) / base.height)
            : (hostW - 8) / base.width;
        const scale =
          Math.min(2, Math.max(0.3, fitScale)) * Math.min(2, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale, rotation: rotate });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.className =
          fitMode === "page"
            ? "mx-auto block h-auto max-h-full w-auto max-w-full rounded-md border border-border/60 bg-white shadow-sm"
            : "w-full rounded-md border border-border/60 bg-white shadow-sm";
        canvas.setAttribute("aria-label", `Halaman ${i}`);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        host.appendChild(canvas);
        await page.render({ canvasContext: ctx, viewport }).promise;
        pageElsRef.current[i - 1] = canvas;

        // Thumbnail kecil untuk navigasi lompat halaman.
        if (thumbHost) {
          const tScale = 92 / base.width;
          const tView = page.getViewport({ scale: tScale, rotation: rotate });
          const tCanvas = document.createElement("canvas");
          tCanvas.width = Math.floor(tView.width);
          tCanvas.height = Math.floor(tView.height);
          tCanvas.className = "h-full w-full object-contain bg-white";
          const tCtx = tCanvas.getContext("2d");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.dataset.page = String(i);
          btn.setAttribute("aria-label", `Lompat ke halaman ${i}`);
          btn.className =
            "relative h-20 w-[64px] shrink-0 overflow-hidden rounded-md border border-border/60 transition hover:border-primary";
          const badge = document.createElement("span");
          badge.textContent = String(i);
          badge.className =
            "absolute bottom-0 right-0 rounded-tl bg-background/85 px-1 text-[10px] font-medium text-foreground";
          if (tCtx) {
            btn.appendChild(tCanvas);
            btn.appendChild(badge);
            thumbHost.appendChild(btn);
            await page.render({ canvasContext: tCtx, viewport: tView }).promise;
          }
        }
      }
      setStatus("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  const goToPage = useCallback((n: number) => {
    const el = pageElsRef.current[n - 1];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrent(n);
  }, []);

  // Klik thumbnail → lompat ke halaman (delegasi, karena thumbnail dibuat imperatif).
  useEffect(() => {
    const host = thumbHostRef.current;
    if (!host) return;
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-page]");
      if (btn?.dataset.page) goToPage(Number(btn.dataset.page));
    };
    host.addEventListener("click", onClick);
    return () => host.removeEventListener("click", onClick);
  }, [goToPage, status]);

  // Sorot halaman aktif saat digulir.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || status !== "ready") return;
    const onScroll = () => {
      const top = host.getBoundingClientRect().top;
      let active = 1;
      pageElsRef.current.forEach((el, idx) => {
        if (el && el.getBoundingClientRect().top - top <= 60) active = idx + 1;
      });
      setCurrent(active);
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => host.removeEventListener("scroll", onScroll);
  }, [status]);

  // Tandai thumbnail aktif.
  useEffect(() => {
    const host = thumbHostRef.current;
    if (!host) return;
    host.querySelectorAll<HTMLElement>("[data-page]").forEach((btn) => {
      const on = Number(btn.dataset.page) === current;
      btn.classList.toggle("ring-2", on);
      btn.classList.toggle("ring-primary", on);
      btn.classList.toggle("border-primary", on);
    });
  }, [current, pages, status]);

  useEffect(() => {
    if (!open || !source) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      const host = hostRef.current;
      if (!host || cancelled) return;
      void render(source.blob, host, thumbHostRef.current, fit, rotation);
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [open, source, render, fit, rotation]);

  useEffect(() => {
    if (!open) {
      setStatus("idle");
      setPages(0);
      setCurrent(1);
      setFit("width");
      setRotation(0);
      pageElsRef.current = [];
      if (hostRef.current) hostRef.current.innerHTML = "";
      if (thumbHostRef.current) thumbHostRef.current.innerHTML = "";
    }
  }, [open]);

  // Setiap dokumen baru dibuka: isi ulang kolom nama dengan nama bawaan.
  useEffect(() => {
    if (open && source) setName(source.filename.replace(/\.pdf$/i, ""));
  }, [open, source]);

  const finalName = sanitizePdfFilename(name, source?.filename ?? "dokumen.pdf");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[min(96vw,720px)] flex-col gap-3 overflow-hidden p-3 sm:p-4">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="truncate text-xs">
            {finalName}
            {pages > 0 ? ` · ${pages} halaman` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 gap-2">
          <div
            ref={thumbHostRef}
            data-testid="pdf-preview-thumbs"
            aria-label="Navigasi halaman"
            className={`${pages > 1 ? "flex" : "hidden"} w-[76px] shrink-0 flex-col gap-2 overflow-y-auto rounded-lg bg-muted/40 p-1.5`}
          />
          <div
            ref={hostRef}
            data-testid="pdf-preview-pages"
            className="min-h-[220px] flex-1 space-y-3 overflow-y-auto rounded-lg bg-muted/40 p-2"
          />
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant={fit === "width" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2 text-xs"
              aria-pressed={fit === "width"}
              data-testid="pdf-preview-fit-width"
              onClick={() => setFit("width")}
            >
              <MoveHorizontal className="mr-1 h-3.5 w-3.5" aria-hidden /> Muat lebar
            </Button>
            <Button
              type="button"
              variant={fit === "page" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2 text-xs"
              aria-pressed={fit === "page"}
              data-testid="pdf-preview-fit-page"
              onClick={() => setFit("page")}
            >
              <Maximize2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Satu halaman
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Putar berlawanan arah jarum jam"
              data-testid="pdf-preview-rotate-left"
              onClick={() => setRotation((r) => (r + 270) % 360)}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <span className="w-10 text-center text-[11px] tabular-nums text-muted-foreground">
              {rotation}°
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Putar searah jarum jam"
              data-testid="pdf-preview-rotate-right"
              onClick={() => setRotation((r) => (r + 90) % 360)}
            >
              <RotateCw className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>

        {pages > 1 && (
          <div className="flex shrink-0 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Halaman sebelumnya"
              disabled={current <= 1}
              onClick={() => goToPage(current - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <span data-testid="pdf-preview-page-indicator">
              Halaman {current} / {pages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Halaman berikutnya"
              disabled={current >= pages}
              onClick={() => goToPage(current + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        )}

        {status === "loading" && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Menyiapkan pratinjau…
          </p>
        )}
        {status === "error" && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Pratinjau gagal dimuat ({errMsg}). Berkas tetap bisa diunduh.
          </p>
        )}

        <div className="shrink-0 space-y-1.5">
          <Label htmlFor="pdf-filename" className="text-xs text-muted-foreground">
            Nama berkas
          </Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                id="pdf-filename"
                data-testid="pdf-preview-filename"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="nama-dokumen"
                className="h-9 pr-12 text-sm"
                autoComplete="off"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                .pdf
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Kembalikan nama bawaan"
              title="Kembalikan nama bawaan"
              disabled={!source}
              onClick={() => setName((source?.filename ?? "").replace(/\.pdf$/i, ""))}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="pdf-preview-download"
            disabled={!source}
            onClick={() => {
              if (!source) return;
              triggerDownload(source.blob, finalName);
              onDownloaded?.();
              onOpenChange(false);
            }}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Unduh PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PdfPreviewDialog;
