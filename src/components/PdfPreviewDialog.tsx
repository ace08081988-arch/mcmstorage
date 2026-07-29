import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Download, FileWarning } from "lucide-react";

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

/**
 * Pratinjau PDF sebelum diunduh. Halaman dirender ke <canvas> lewat pdf.js
 * supaya tetap tampil di Android WebView (yang tidak punya viewer PDF bawaan).
 */
export function PdfPreviewDialog({ open, onOpenChange, source, title = "Pratinjau PDF", onDownloaded }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [pages, setPages] = useState(0);
  const [errMsg, setErrMsg] = useState("");

  const render = useCallback(async (blob: Blob, host: HTMLDivElement) => {
    setStatus("loading");
    setErrMsg("");
    try {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

      const data = new Uint8Array(await blob.arrayBuffer());
      const doc = await pdfjs.getDocument({ data }).promise;
      host.innerHTML = "";
      setPages(doc.numPages);

      const hostW = host.clientWidth || 320;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, Math.max(0.5, (hostW - 8) / base.width)) * Math.min(2, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.className = "w-full rounded-md border border-border/60 bg-white shadow-sm";
        canvas.setAttribute("aria-label", `Halaman ${i}`);
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        host.appendChild(canvas);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      }
      setStatus("ready");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!open || !source) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      const host = hostRef.current;
      if (!host || cancelled) return;
      void render(source.blob, host);
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [open, source, render]);

  useEffect(() => {
    if (!open) {
      setStatus("idle");
      setPages(0);
      if (hostRef.current) hostRef.current.innerHTML = "";
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[min(96vw,720px)] flex-col gap-3 overflow-hidden p-3 sm:p-4">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="truncate text-xs">
            {source?.filename ?? "—"}
            {pages > 0 ? ` · ${pages} halaman` : ""}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={hostRef}
          data-testid="pdf-preview-pages"
          className="min-h-[220px] flex-1 space-y-3 overflow-y-auto rounded-lg bg-muted/40 p-2"
        />

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
              triggerDownload(source.blob, source.filename);
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
