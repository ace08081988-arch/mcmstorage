/**
 * Modal preview caption WA/Chat sebelum benar-benar mengirim.
 *
 * Dipakai oleh SendEcerPrepsDialog dan SendPrepToCustomerDialog. Menampilkan
 * teks caption lengkap (judul paket, rincian, total, metode bayar + sisa
 * hutang, catatan, dan link lokasi) di dalam <pre> yang bisa di-scroll dan
 * disalin. Owner harus menekan "Kirim sekarang" untuk melanjutkan; tombol
 * "Periksa lagi" menutup modal tanpa mengirim.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Images, Loader2, MapPin, MessageCircle, Send } from "lucide-react";
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
  locationMissing,
  locationHint,
  onSaveLocation,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  caption: string;
  channel?: CaptionPreviewChannel;
  photoCount?: number;
  busy?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  /** True jika tidak ada `location_url` di kartu penyiapan → 📍 tidak akan
   * ikut terkirim. UI menampilkan banner amber sebagai peringatan. */
  locationMissing?: boolean;
  /** Petunjuk singkat cara mengisi lokasi (mis. rute yang harus dibuka). */
  locationHint?: string;
  /** Kalau disediakan, banner peringatan lokasi menampilkan input inline
   * + tombol "Simpan lokasi" supaya owner bisa mengisi `location_url`
   * tanpa keluar dari alur kirim. Callback wajib menyimpan ke DB dan
   * memicu refetch preps di parent — modal akan otomatis re-render dengan
   * caption baru + banner hilang begitu locationMissing=false. */
  onSaveLocation?: (url: string) => Promise<void>;
}) {
  const Icon = channel === "chat" ? MessageCircle : Send;
  const channelLabel = channel === "chat" ? "MCM Chat" : "WhatsApp";
  const defaultConfirm =
    channel === "chat" ? "Kirim Chat sekarang" : "Kirim WA sekarang";

  const [locInput, setLocInput] = useState("");
  const [savingLoc, setSavingLoc] = useState(false);

  // Reset input tiap kali dialog dibuka ulang / status lokasi berubah, supaya
  // draft URL sesi lalu tidak nyangkut.
  useEffect(() => {
    if (!open) { setLocInput(""); setSavingLoc(false); }
  }, [open]);
  useEffect(() => {
    if (!locationMissing) setLocInput("");
  }, [locationMissing]);

  async function handleSaveLocation() {
    const url = locInput.trim();
    if (!url) { toast.error("Tempel link Google Maps dulu"); return; }
    if (!/^https?:\/\//i.test(url)) {
      toast.error("Link harus diawali http:// atau https://");
      return;
    }
    if (!onSaveLocation) return;
    setSavingLoc(true);
    try {
      await onSaveLocation(url);
      toast.success("Lokasi tersimpan — caption otomatis diperbarui");
    } catch (e) {
      toast.error("Gagal simpan lokasi: " + (e as Error).message);
    } finally {
      setSavingLoc(false);
    }
  }

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
            dikirim. Foto ikut terkirim bersama pesan ini.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-ms-2">
          {typeof photoCount === "number" ? (
            <div
              data-testid="caption-preview-photo-count"
              className={`flex items-center gap-ms-2 rounded-md border p-ms-2 text-ms-2xs ${
                photoCount > 0
                  ? "border-primary/30 bg-primary/5 text-foreground"
                  : "border-amber-400/60 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-100"
              }`}
            >
              {photoCount > 0 ? (
                <Images className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {photoCount > 0
                    ? `${photoCount.toLocaleString("id-ID")} foto akan dikirim`
                    : "Tidak ada foto — hanya teks"}
                </div>
                <div className="opacity-80">
                  {photoCount > 1
                    ? `Foto dikirim satu per satu (1–${photoCount}) mengikuti urutan kotak.`
                    : photoCount === 1
                    ? "1 lampiran foto menyertai pesan ini."
                    : "Pesan tetap bisa dikirim tanpa lampiran."}
                </div>
              </div>
              {photoCount > 0 ? (
                <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary tabular-nums">
                  ×{photoCount}
                </span>
              ) : null}
            </div>
          ) : null}
          {locationMissing ? (
            <div
              role="alert"
              data-testid="caption-preview-loc-warning"
              className="flex items-start gap-ms-2 rounded-md border border-amber-400/60 bg-amber-50 p-ms-2 text-ms-2xs text-amber-900 dark:border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              <div className="space-y-1">
                <div className="font-semibold">
                  Lokasi belum diisi — 📍 tidak akan ikut terkirim
                </div>
                <div className="opacity-90">
                  {locationHint ??
                    "Buka kartu penyiapan → isi kolom Lokasi ambil (link Google Maps), lalu buka ulang tombol Kirim."}
                </div>
                {onSaveLocation ? (
                  <div className="space-y-1 pt-1">
                    <label className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide opacity-80">
                      <MapPin className="h-3 w-3" aria-hidden />
                      Isi sekarang (tempel link Google Maps)
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="url"
                        inputMode="url"
                        placeholder="https://maps.google.com/…"
                        value={locInput}
                        onChange={(e) => setLocInput(e.target.value)}
                        disabled={savingLoc || busy}
                        data-testid="caption-preview-loc-input"
                        className="h-7 min-w-0 flex-1 rounded border border-amber-300 bg-white px-2 text-ms-2xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500 dark:bg-amber-950/70 dark:text-amber-50"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={handleSaveLocation}
                        disabled={savingLoc || busy || !locInput.trim()}
                        data-testid="caption-preview-loc-save"
                        className="h-7 px-2 text-ms-2xs"
                      >
                        {savingLoc ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <Check className="mr-1 h-3 w-3" aria-hidden />
                        )}
                        Simpan
                      </Button>
                    </div>
                    <div className="opacity-70">
                      Pesan tetap bisa dikirim tanpa lokasi.
                    </div>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1 opacity-80">
                    <MapPin className="h-3 w-3" aria-hidden />
                    Pesan tetap bisa dikirim tanpa lokasi.
                  </div>
                )}
              </div>
            </div>
          ) : null}
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