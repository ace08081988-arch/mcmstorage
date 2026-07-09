import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, MapPin } from "lucide-react";

/**
 * Dialog verifikasi submisi karyawan (Request & Ecer).
 * Admin: Setuju → RPC `prep_submission_verify` decision=approved.
 *        Tolak  → wajib isi alasan, decision=rejected.
 */
export type VerificationSubmission = {
  id: string;
  submitted_at: string;
  photo_paths?: string[] | null;
  photo_path?: string | null;
  location_url?: string | null;
  note?: string | null;
  qty_reported?: number | null;
  employee_label?: string | null;
};

export function VerificationDialog({
  open,
  onOpenChange,
  submission,
  photoUrls,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  submission: VerificationSubmission | null;
  photoUrls?: string[];
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  async function decide(decision: "approved" | "rejected") {
    if (!submission) return;
    if (decision === "rejected" && reason.trim().length < 3) {
      toast.error("Isi alasan penolakan (min. 3 karakter)");
      return;
    }
    setBusy(true);
    try {
      const args: { _submission_id: string; _decision: string; _reason?: string } = {
        _submission_id: submission.id,
        _decision: decision,
      };
      if (decision === "rejected") args._reason = reason.trim();
      const { data, error } = await supabase.rpc("prep_submission_verify", args);
      if (error) throw error;
      const res = data as {
        ok?: boolean;
        stock_changed?: boolean;
        stock_delta_qty?: number;
      } | null;
      if (!res?.ok) throw new Error("Verifikasi gagal");
      // H9: assert klien — pada penolakan submisi pending, stok tidak
      // boleh berubah. Jika RPC melaporkan perubahan stok, tampilkan
      // peringatan alih-alih sukses diam-diam.
      if (decision === "rejected" && res.stock_changed === true) {
        toast.warning(
          `Ditolak — stok berubah ${res.stock_delta_qty ?? 0}. Periksa audit trail.`,
        );
      } else if (decision === "rejected") {
        toast.success("Ditolak. Stok tidak berubah.");
      } else {
        toast.success("Disetujui");
      }
      setReason("");
      setRejecting(false);
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error("Gagal: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Verifikasi Penyiapan</DialogTitle>
          <DialogDescription>
            Periksa foto, lokasi, dan catatan karyawan sebelum menyetujui.
          </DialogDescription>
        </DialogHeader>

        {submission ? (
          <div className="space-y-3 text-sm">
            {photoUrls && photoUrls.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {photoUrls.map((u, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={u}
                    alt={`Foto ${i + 1}`}
                    className="aspect-square w-full rounded border object-cover"
                    loading="lazy"
                  />
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-[6rem_1fr] gap-y-1 text-xs">
              <span className="text-muted-foreground">Karyawan</span>
              <span className="min-w-0 truncate">{submission.employee_label ?? "—"}</span>
              <span className="text-muted-foreground">Waktu</span>
              <span>{new Date(submission.submitted_at).toLocaleString("id-ID")}</span>
              {submission.qty_reported != null ? (
                <>
                  <span className="text-muted-foreground">Qty</span>
                  <span>{submission.qty_reported}</span>
                </>
              ) : null}
              {submission.note ? (
                <>
                  <span className="text-muted-foreground">Catatan</span>
                  <span className="whitespace-pre-wrap">{submission.note}</span>
                </>
              ) : null}
            </div>
            {submission.location_url ? (
              <a
                href={submission.location_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
              >
                <MapPin className="h-3.5 w-3.5" /> Buka lokasi
              </a>
            ) : null}

            {rejecting ? (
              <div className="space-y-1">
                <label className="text-xs font-medium">Alasan penolakan</label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Foto buram, produk salah, dsb."
                  rows={3}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Tidak ada data submisi.</p>
        )}

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          {rejecting ? (
            <>
              <Button
                variant="ghost"
                onClick={() => { setRejecting(false); setReason(""); }}
                disabled={busy}
              >
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={() => decide("rejected")}
                disabled={busy}
              >
                <X className="mr-1 h-4 w-4" /> Kirim Penolakan
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setRejecting(true)}
                disabled={busy || !submission}
                aria-label="Tolak submisi"
              >
                <X className="mr-1 h-4 w-4" /> Tolak
              </Button>
              <Button
                onClick={() => decide("approved")}
                disabled={busy || !submission}
                aria-label="Setujui submisi"
                className="bg-success text-success-foreground hover:bg-success/90"
              >
                <Check className="mr-1 h-4 w-4" /> Setuju
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}