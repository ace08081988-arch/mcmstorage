import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Download, QrCode as QrIcon } from "lucide-react";

/**
 * Tampilkan QR code untuk link tugas (opsional ditempel PIN sebagai teks).
 * Pegawai bisa memindai pakai HP di lapangan untuk membuka halaman tugas
 * tanpa harus mengetik URL panjang.
 */
export function TaskQrCode({ url, pin, title }: { url: string; pin?: string; title?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dataUrl, setDataUrl] = useState<string>("");
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const el = canvasRef.current;
    if (!el || !url) return;
    QRCode.toCanvas(el, url, { width: 220, margin: 1, errorCorrectionLevel: "M" })
      .then(() => {
        if (cancelled) return;
        setErr("");
        try {
          setDataUrl(el.toDataURL("image/png"));
        } catch {
          /* ignore */
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  function download() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    const slug = (title || "tugas").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "tugas";
    a.download = `qr-${slug}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("QR code diunduh");
  }

  return (
    <div className="space-y-2 rounded-md border bg-background p-3 text-center">
      <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
        <QrIcon className="h-3.5 w-3.5" /> QR code link pegawai
      </div>
      <div className="flex justify-center">
        <canvas ref={canvasRef} className="rounded bg-white p-1" aria-label="QR code link tugas" />
      </div>
      {pin ? (
        <div className="text-[11px] text-muted-foreground">
          PIN: <span className="font-mono tracking-widest text-foreground">{pin}</span>
        </div>
      ) : null}
      {err ? <div className="text-[11px] text-destructive">Gagal membuat QR: {err}</div> : null}
      <button
        type="button"
        onClick={download}
        disabled={!dataUrl}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" /> Unduh PNG
      </button>
    </div>
  );
}