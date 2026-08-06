import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export type DuplicateConflictInfo = {
  /** Label field yang bentrok, mis. "Nomor telepon". */
  label: string;
  /** Penjelasan singkat kenapa dianggap ganda. */
  reason: string;
  /** Kontak lama yang dianggap duplikat. */
  existing: { name: string; phone?: string | null; email?: string | null; note?: string | null };
  /** Data baru yang sedang diisi. */
  incoming: { name: string; phone?: string | null; email?: string | null };
};

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-ms-2 text-ms-xs">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words font-medium">{value}</span>
    </div>
  );
}

/**
 * Alur konflik duplikat: tampilkan kontak lama vs data baru, lalu beri pilihan
 * tetap simpan (paksa) atau batalkan. Menyimpan paksa tetap bisa ditolak
 * database bila ada indeks unik — pesan errornya akan muncul setelahnya.
 */
export function DuplicateConflictDialog({
  open,
  onOpenChange,
  info,
  busy,
  onKeep,
  onOpenExisting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  info: DuplicateConflictInfo | null;
  busy?: boolean;
  onKeep: () => void;
  onOpenExisting?: () => void;
}) {
  return (
    <Dialog open={open && !!info} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-ms-2">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
            Kontak serupa ditemukan
          </DialogTitle>
          <DialogDescription>
            {info ? `${info.label} ini sudah dipakai kontak lain. Periksa dulu sebelum menyimpan.` : ""}
          </DialogDescription>
        </DialogHeader>
        {info && (
          <div className="space-y-ms-3">
            <p className="rounded-md border border-warning/40 bg-warning/10 px-ms-3 py-ms-2 text-ms-xs text-foreground">
              {info.reason}
            </p>
            <div className="grid gap-ms-2 sm:grid-cols-2">
              <div className="space-y-ms-1 rounded-lg border p-ms-3">
                <p className="text-ms-xs font-semibold text-muted-foreground">Kontak tersimpan</p>
                <Row label="Nama" value={info.existing.name} />
                <Row label="Nomor" value={info.existing.phone} />
                <Row label="Email" value={info.existing.email} />
                <Row label="Catatan" value={info.existing.note} />
              </div>
              <div className="space-y-ms-1 rounded-lg border border-primary/40 p-ms-3">
                <p className="text-ms-xs font-semibold text-muted-foreground">Data baru</p>
                <Row label="Nama" value={info.incoming.name} />
                <Row label="Nomor" value={info.incoming.phone} />
                <Row label="Email" value={info.incoming.email} />
              </div>
            </div>
            {onOpenExisting && (
              <Button type="button" size="sm" variant="outline" onClick={onOpenExisting}>
                Buka kontak "{info.existing.name}"
              </Button>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Batalkan
          </Button>
          <Button onClick={onKeep} disabled={busy}>
            {busy ? "Menyimpan…" : "Tetap simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
