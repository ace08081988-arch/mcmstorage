import { Phone, Video as VideoIcon, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatCallDuration, type CallRow } from "@/lib/calls";
import { CALL_STATUS_LABEL } from "@/lib/call-export";

function fullTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-ms-3 border-b py-ms-2 last:border-b-0">
      <span className="shrink-0 text-ms-2xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-right text-ms-xs font-medium break-words">
        {value}
      </span>
    </div>
  );
}

export function CallDetailSheet({
  row,
  myId,
  nameMap,
  onOpenChange,
  onDelete,
}: {
  row: CallRow | null;
  myId: string | null;
  nameMap: Record<string, string>;
  onOpenChange: (open: boolean) => void;
  onDelete: (row: CallRow) => void;
}) {
  const outgoing = row ? row.caller_id === myId : false;
  const peerId = row ? (outgoing ? row.callee_id : row.caller_id) : null;
  const peerName = (peerId && nameMap[peerId]) || "Kontak";
  const Icon = row?.kind === "video" ? VideoIcon : Phone;

  return (
    <Sheet open={!!row} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="space-y-1 text-left">
          <SheetTitle className="flex items-center gap-ms-2">
            <Icon className="h-4 w-4 text-primary" /> Detail panggilan
          </SheetTitle>
          <SheetDescription>
            Informasi lengkap sebelum Anda menghapus entri ini.
          </SheetDescription>
        </SheetHeader>

        {row ? (
          <>
            <div className="mt-ms-3">
              <Field label="Kontak" value={peerName} />
              <Field label="Jenis" value={row.kind === "video" ? "Video" : "Suara"} />
              <Field label="Arah" value={outgoing ? "Keluar" : "Masuk"} />
              <Field
                label="Status"
                value={CALL_STATUS_LABEL[row.status] ?? row.status}
              />
              <Field label="Mulai" value={fullTime(row.started_at)} />
              <Field label="Dijawab" value={fullTime(row.accepted_at)} />
              <Field label="Berakhir" value={fullTime(row.ended_at)} />
              <Field label="Durasi" value={formatCallDuration(row.duration_sec ?? 0)} />
              {row.end_reason ? (
                <Field label="Alasan berakhir" value={row.end_reason} />
              ) : null}
            </div>

            <div className="mt-ms-4 flex items-center gap-ms-2">
              <Button
                type="button"
                variant="destructive"
                className="flex-1 gap-ms-1.5"
                onClick={() => onDelete(row)}
              >
                <Trash2 className="h-4 w-4" /> Hapus entri ini
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Tutup
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
