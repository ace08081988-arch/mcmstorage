import { useEffect, useRef, useState } from "react";
import { Copy, Check, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export type ApkQrTarget = {
  label: string;
  url: string;
  meta?: string;
};

export function ApkQrDialog({
  target,
  onOpenChange,
}: {
  target: ApkQrTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendering, setRendering] = useState(false);
  const [copied, setCopied] = useState(false);
  const open = target !== null;

  useEffect(() => {
    if (!open || !target) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setRendering(true);
    let cancelled = false;
    import("qrcode")
      .then(({ default: QRCode }) => {
        if (cancelled) return;
        return QRCode.toCanvas(canvas, target.url, {
          width: 260,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#000000", light: "#ffffff" },
        });
      })
      .catch(() => {
        if (!cancelled) toast.error("Gagal membuat QR code");
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  const copyUrl = async () => {
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Gagal menyalin link");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pindai untuk mengunduh</DialogTitle>
          <DialogDescription>
            {target?.label ?? ""}
            {target?.meta ? ` · ${target.meta}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-ms-3">
          <div className="relative grid h-[276px] w-[276px] place-items-center rounded-lg border bg-white p-ms-2">
            <canvas ref={canvasRef} className="h-[260px] w-[260px]" />
            {rendering && (
              <div className="absolute inset-0 grid place-items-center bg-white/60">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          <p className="text-center text-ms-xs text-muted-foreground">
            Buka kamera atau pemindai QR di perangkat lain untuk membuka link unduhan APK.
          </p>
          <div className="flex w-full items-center gap-ms-2 rounded-md border bg-muted/40 px-ms-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-ms-2xs text-muted-foreground">
              {target?.url}
            </span>
            <button
              type="button"
              onClick={copyUrl}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md border hover:bg-accent"
              aria-label="Salin link"
              title="Salin link"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}