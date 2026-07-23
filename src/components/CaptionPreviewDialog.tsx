/**
 * Modal preview caption WA/Chat sebelum benar-benar mengirim.
 *
 * Dipakai oleh SendEcerPrepsDialog dan SendPrepToCustomerDialog. Menampilkan
 * teks caption lengkap (judul paket, rincian, total, metode bayar + sisa
 * hutang, catatan, dan link lokasi) di dalam <pre> yang bisa di-scroll dan
 * disalin. Owner harus menekan "Kirim sekarang" untuk melanjutkan; tombol
 * "Periksa lagi" menutup modal tanpa mengirim.
 */
import { Copy, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type CaptionPreviewChannel = "wa" | "chat";

export function CaptionPreviewDialog({
  open,
  onOpenChange,
  caption,
  channel = "wa",
  photoCount,
  busy,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  caption: string;
  channel?: CaptionPreviewChannel;
  photoCount?: number;
  busy?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  const Icon = channel === "chat" ? MessageCircle : Send;
  const channelLabel = channel === "chat" ? "MCM Chat" : "WhatsApp";
  const defaultConfirm =
    channel === "chat" ? "Kirim Chat sekarang" : "Kirim WA sekarang";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(caption);
      toast.success("Caption disalin ke clipboard");
    } catch {
      toast.error("Gagal menyalin — salin manual dari kotak preview");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-ms-2 text-ms-base">
            <Icon className="h-4 w-4 text-primary" aria-hidden />
            Preview pesan {channelLabel}
          </DialogTitle>
          <DialogDescription>
            Periksa isi pesan (termasuk sisa hutang dan link lokasi) sebelum
            dikirim. Foto{typeof photoCount === "number" ? ` (${photoCount})` : ""} ikut terkirim bersama pesan ini.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-ms-2">
          <pre
            data-testid="caption-preview-text"
            className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-ms-2 font-sans text-ms-2xs leading-relaxed"
          >
{caption || "(caption kosong)"}
          </pre>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{caption.length.toLocaleString("id-ID")} karakter</span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-muted"
            >
              <Copy className="h-3 w-3" aria-hidden /> Salin
            </button>
          </div>
        </div>

        <DialogFooter className="grid grid-cols-2 gap-ms-2 sm:grid-cols-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Periksa lagi
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={busy || !caption.trim()}
            data-testid="caption-preview-confirm"
          >
            {busy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Icon className="mr-1 h-3.5 w-3.5" aria-hidden />
            )}
            {confirmLabel ?? defaultConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}