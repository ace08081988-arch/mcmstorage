/**
 * Dialog konfirmasi + dialog alasan pembatalan untuk alur auto-Kirim
 * (flag `send=1` dari beranda). Diekstrak dari `_authenticated.ecer.tsx`
 * supaya bisa dipakai oleh harness e2e non-auth (`/lovable/visual/
 * auto-send-cancel`) TANPA menduplikasi implementasi — spec Playwright
 * kemudian menguji komponen yang sama persis dengan yang dijalankan di
 * halaman /ecer produksi.
 *
 * Kontrak (jangan diubah tanpa menyinkronkan test guardrail):
 *   • AutoSendConfirmDialog.onCancel  : dipanggil ketika Batal / dismiss
 *     — TIDAK BOLEH membuka dialog pembayaran, tugas pemanggil.
 *   • AutoSendConfirmDialog.onConfirm : SATU-SATUNYA jalur yang
 *     mengizinkan pemanggil membuka dialog pembayaran.
 *   • AutoSendCancelReasonDialog       : dipakai setelah cancel; note JSON
 *     final di-set oleh pemanggil via onSubmit / onDismiss.
 */
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ChevronDown } from "lucide-react";
import type { EcerTitle, EcerPreparation } from "@/lib/ecer";

export function AutoSendConfirmDialog({
  state,
  title,
  itemName,
  onCancel,
  onConfirm,
}: {
  state: { preps: EcerPreparation[] } | null;
  title: EcerTitle;
  itemName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Default terbuka: owner harus bisa memverifikasi kotak (produk,
  // judul, jumlah, berat per kotak) TANPA klik tambahan.
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (state) setExpanded(true);
  }, [state]);
  if (!state) return null;
  const preps = state.preps;
  const unit = title.unit_label || "g";
  const totalGrams = preps.reduce(
    (acc, p) => acc + (Number(p.actual_grams) || 0),
    0,
  );
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent className="max-w-md" data-testid="auto-send-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>Konfirmasi kirim ke pembeli</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1 text-sm">
              <div><span className="text-muted-foreground">Produk:</span> <span className="font-medium text-foreground">{itemName}</span></div>
              <div><span className="text-muted-foreground">Judul:</span> <span className="font-medium text-foreground">{title.name}</span></div>
              <div><span className="text-muted-foreground">Jumlah:</span> <span className="font-medium text-foreground">{preps.length} kotak</span></div>
              <div><span className="text-muted-foreground">Total:</span> <span className="font-medium text-foreground">{totalGrams} {unit}</span></div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              data-testid="auto-send-toggle-list"
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs font-medium hover:bg-muted"
            >
              <span>Daftar kotak ({preps.length})</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent
            data-testid="auto-send-list"
            className="mt-2 max-h-56 overflow-y-auto rounded-md border"
          >
            <ul className="divide-y">
              {preps.map((p, i) => (
                <li
                  key={p.id}
                  data-testid="auto-send-list-item"
                  className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                >
                  <span className="text-muted-foreground">
                    #{i + 1} · <span className="font-mono">{String(p.id).slice(0, 8)}</span>
                  </span>
                  <span className="font-medium tabular-nums">
                    {Number(p.actual_grams) || 0} {unit}
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={onCancel}
            data-testid="auto-send-confirm-cancel"
          >
            Batal
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            data-testid="auto-send-confirm-continue"
          >
            Lanjut ke pembayaran
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Preset alasan pembatalan (token stabil untuk audit note). */
export const AUTO_SEND_CANCEL_REASONS: Array<{ value: string; label: string }> = [
  { value: "salah_pilih", label: "Salah pilih paket / seleksi" },
  { value: "belum_siap", label: "Belum siap kirim sekarang" },
  { value: "pembeli_batal", label: "Pembeli batal / pending konfirmasi" },
  { value: "cek_ulang", label: "Perlu cek ulang berat / harga" },
  { value: "lainnya", label: "Lainnya (isi detail)" },
];

export type AutoSendCancelState = {
  preps: EcerPreparation[];
  auditId: string;
  source: "confirm_modal" | "closed_send_dialog";
};

export function AutoSendCancelReasonDialog({
  state,
  title,
  itemName,
  onSubmit,
  onDismiss,
}: {
  state: AutoSendCancelState | null;
  title: EcerTitle;
  itemName: string;
  onSubmit: (reason: string, detail: string) => void;
  onDismiss: () => void;
}) {
  const [reason, setReason] = useState<string>("salah_pilih");
  const [detail, setDetail] = useState<string>("");
  useEffect(() => {
    if (state) {
      setReason("salah_pilih");
      setDetail("");
    }
  }, [state]);
  if (!state) return null;
  const preps = state.preps;
  const unit = title.unit_label || "g";
  const totalGrams = preps.reduce(
    (acc, p) => acc + (Number(p.actual_grams) || 0),
    0,
  );
  const submit = () => onSubmit(reason, detail.trim());
  return (
    <AlertDialog
      open
      onOpenChange={(o) => {
        if (!o) onDismiss();
      }}
    >
      <AlertDialogContent
        className="max-w-md"
        data-testid="auto-send-cancel-reason"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Alasan pembatalan auto-Kirim</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Produk:</span>{" "}
                <span className="font-medium text-foreground">{itemName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Judul:</span>{" "}
                <span className="font-medium text-foreground">{title.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Seleksi:</span>{" "}
                <span className="font-medium text-foreground">
                  {preps.length} kotak · {totalGrams} {unit}
                </span>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <RadioGroup
            value={reason}
            onValueChange={setReason}
            data-testid="auto-send-cancel-reason-group"
          >
            {AUTO_SEND_CANCEL_REASONS.map((r) => (
              <label
                key={r.value}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                data-testid={`auto-send-cancel-reason-${r.value}`}
              >
                <RadioGroupItem value={r.value} />
                <span>{r.label}</span>
              </label>
            ))}
          </RadioGroup>
          <div className="space-y-1">
            <Label htmlFor="auto-send-cancel-detail" className="text-xs">
              Detail (opsional)
            </Label>
            <Textarea
              id="auto-send-cancel-detail"
              data-testid="auto-send-cancel-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Catatan singkat supaya mudah ditelusuri…"
              rows={2}
              maxLength={280}
            />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDismiss}>Lewati</AlertDialogCancel>
          <AlertDialogAction
            onClick={submit}
            data-testid="auto-send-cancel-submit"
          >
            Simpan alasan
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}