import { useEffect, useRef, useState } from "react";
import { Camera, X, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Dialog pemindai QR/barcode berbasis kamera perangkat. Dipakai di
 * setiap tempat yang menampilkan QR (halaman Undang, dialog QR profil,
 * dan `TaskQrCode`) sehingga user bisa memindai QR balasan tanpa keluar
 * aplikasi.
 *
 * - Decoder: `jsqr` (pure JS, kecil, tanpa native deps).
 * - Preferensi kamera belakang (`facingMode: "environment"`); fallback
 *   ke kamera depan bila back-camera menolak/tidak ada.
 * - Rilis MediaStream + cancel animation frame saat dialog ditutup atau
 *   hasil terkirim ke `onResult`.
 */
export function QrScannerDialog({
  open,
  onOpenChange,
  onResult,
  title = "Pindai QR",
  description = "Arahkan kamera ke QR code untuk memindai.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (text: string) => void;
  title?: string;
  description?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setErr(null);
    setStarting(true);

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setErr("Perangkat/browser ini tidak mendukung kamera.");
        setStarting(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.setAttribute("playsinline", "true");
          await v.play().catch(() => {});
        }
        setStarting(false);
        tick();
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setErr(
          /permission|denied|NotAllowed/i.test(msg)
            ? "Izin kamera ditolak. Aktifkan izin kamera untuk aplikasi ini."
            : `Gagal membuka kamera: ${msg}`,
        );
        setStarting(false);
      }
    }

    async function tick() {
      if (cancelled) return;
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.readyState >= 2 && v.videoWidth > 0) {
        const w = v.videoWidth;
        const h = v.videoHeight;
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(v, 0, 0, w, h);
          try {
            const img = ctx.getImageData(0, 0, w, h);
            const { default: jsQR } = await import("jsqr");
            const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
            if (code && code.data) {
              cancelled = true;
              cleanup();
              onResult(code.data);
              onOpenChange(false);
              return;
            }
          } catch {
            /* keep scanning */
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    function cleanup() {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const v = videoRef.current;
      if (v) v.srcObject = null;
    }

    void start();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [open, facing, onOpenChange, onResult]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4" /> {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="relative overflow-hidden rounded-lg bg-black aspect-square">
          {err ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white">
              <span>{err}</span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setErr(null);
                  setFacing((f) => f); // trigger effect re-run via setter
                }}
              >
                <RefreshCcw className="mr-1 h-3.5 w-3.5" /> Coba lagi
              </Button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                muted
                playsInline
                aria-label="Pratinjau kamera"
              />
              <canvas ref={canvasRef} className="hidden" />
              <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              {starting ? (
                <div className="absolute inset-x-0 bottom-3 text-center text-[11px] text-white/80">
                  Menyalakan kamera…
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
            className="gap-1.5"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {facing === "environment" ? "Pakai kamera depan" : "Pakai kamera belakang"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="ml-auto gap-1.5"
          >
            <X className="h-3.5 w-3.5" /> Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Handler default: bila hasil pindai adalah URL http/https yang sama-origin,
 * arahkan pakai `window.location.assign`. URL eksternal dibuka lewat Web Share
 * bila tersedia (preferensi proyek — hindari `window.open`), fallback salin
 * ke clipboard + toast. Selain URL, salin dan tampilkan toast.
 */
export async function handleScannedText(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    const u = new URL(trimmed);
    if (typeof window !== "undefined" && u.origin === window.location.origin) {
      window.location.assign(u.pathname + u.search + u.hash);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ url: trimmed });
        return;
      } catch {
        /* fallthrough */
      }
    }
    await navigator.clipboard.writeText(trimmed).catch(() => {});
    toast.success("Link hasil pindaian disalin.");
    return;
  } catch {
    /* not a URL */
  }
  try {
    await navigator.clipboard.writeText(trimmed);
    toast.success("Hasil pindaian disalin.", { description: trimmed.slice(0, 80) });
  } catch {
    toast.message("Hasil pindaian", { description: trimmed.slice(0, 200) });
  }
}