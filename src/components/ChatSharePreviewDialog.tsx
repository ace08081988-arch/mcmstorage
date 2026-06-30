import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, MapPin, Send } from "lucide-react";

export type ChatSharePreviewData = {
  conversationTitle: string;
  caption: string;
  photoCount: number;
  /** Hingga 4 thumbnail untuk pratinjau visual. */
  thumbs: string[];
  /** Total foto yang sebenarnya akan dikirim (>= thumbs.length). */
  totalPhotos: number;
  /** Foto yang tidak bisa diunduh dari storage (gagal ditambahkan). */
  missingPhotos: number;
  mapsUrl: string | null;
};

/**
 * Dialog konfirmasi sebelum mengirim paket eceran ke chat aplikasi.
 * Menampilkan caption persis seperti yang akan dikirim, jumlah foto, dan link Maps.
 */
export function ChatSharePreviewDialog({
  open,
  onOpenChange,
  data,
  sending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ChatSharePreviewData | null;
  sending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!sending) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pratinjau kiriman chat</DialogTitle>
          <DialogDescription>
            {data ? <>Akan dikirim ke <span className="font-medium text-foreground">{data.conversationTitle}</span>. Periksa format sebelum mengirim.</> : "Menyiapkan…"}
          </DialogDescription>
        </DialogHeader>

        {data && (
          <div className="space-y-3 text-sm">
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caption</h3>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 font-sans text-[12.5px] leading-snug">{data.caption || "(kosong)"}</pre>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Foto · {data.totalPhotos}
                {data.missingPhotos > 0 && (
                  <span className="ml-1 font-normal normal-case text-amber-600">({data.missingPhotos} gagal diunduh)</span>
                )}
              </h3>
              {data.totalPhotos === 0 ? (
                <p className="text-xs text-muted-foreground">Tidak ada foto yang dapat dilampirkan.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {data.thumbs.slice(0, 4).map((u, i) => (
                    <div key={i} className="h-14 w-14 overflow-hidden rounded border bg-muted">
                      <img src={u} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ))}
                  {data.totalPhotos > 4 && (
                    <div className="flex h-14 w-14 items-center justify-center rounded border bg-muted text-xs font-semibold text-muted-foreground">
                      +{data.totalPhotos - 4}
                    </div>
                  )}
                </div>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">Tiap foto dikirim sebagai pesan terpisah.</p>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Link Maps</h3>
              {data.mapsUrl ? (
                <a
                  href={data.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 truncate rounded-md border bg-muted/40 px-2 py-1 text-[12px] text-primary hover:underline"
                >
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{data.mapsUrl}</span>
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">Tidak ada lokasi yang dilampirkan.</p>
              )}
            </section>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={sending}
            className="inline-flex h-9 items-center justify-center rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={sending || !data}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Mengirim…" : "Kirim sekarang"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}