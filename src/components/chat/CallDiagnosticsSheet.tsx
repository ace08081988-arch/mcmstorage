import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Trash2, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  clearCallLogs, formatCallLogs, formatTime, getCallLogs, subscribeCallLogs,
  type CallLogEntry,
} from "@/lib/call-diagnostics";

const KIND_CLASS: Record<CallLogEntry["kind"], string> = {
  ice: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  sig: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  gather: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  signal: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  recovery: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  finalize: "bg-destructive/15 text-destructive",
  info: "bg-muted text-muted-foreground",
};

/** Panel log diagnosa ICE/signaling untuk satu panggilan (atau semua). */
export function CallDiagnosticsSheet({
  open, onOpenChange, callId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  callId?: string;
}) {
  const [all, setAll] = useState<CallLogEntry[]>([]);
  const [onlyThisCall, setOnlyThisCall] = useState(Boolean(callId));

  useEffect(() => {
    if (!open) return;
    setAll(getCallLogs());
    return subscribeCallLogs(setAll);
  }, [open]);

  const entries = useMemo(
    () => (onlyThisCall && callId ? all.filter((e) => e.callId === callId) : all),
    [all, onlyThisCall, callId],
  );

  const copy = useCallback(async () => {
    const text = formatCallLogs(entries);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Log disalin", { description: "Tempel di WhatsApp untuk dikirim." });
    } catch {
      toast.error("Gagal menyalin log di perangkat ini.");
    }
  }, [entries]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] p-0">
        <SheetHeader className="border-b p-ms-4 text-left">
          <SheetTitle className="flex items-center gap-ms-2">
            <ScrollText className="h-4 w-4" /> Log diagnosa panggilan
          </SheetTitle>
          <SheetDescription>
            Riwayat iceConnectionState, signalingState, sinyal SDP, dan keputusan
            pemulihan/finalize. Tersimpan di perangkat ini ({all.length} entri).
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-ms-2 border-b p-ms-3">
          {callId ? (
            <Button
              size="sm"
              variant={onlyThisCall ? "default" : "outline"}
              onClick={() => setOnlyThisCall((v) => !v)}
            >
              {onlyThisCall ? "Panggilan ini" : "Semua panggilan"}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={copy}>
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Salin
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { clearCallLogs(); toast.success("Log dibersihkan"); }}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Bersihkan
          </Button>
        </div>

        <div className="h-[calc(85vh-11rem)] overflow-y-auto p-ms-3">
          {entries.length === 0 ? (
            <p className="p-ms-6 text-center text-ms-sm text-muted-foreground">
              Belum ada log. Log terisi otomatis saat panggilan berjalan.
            </p>
          ) : (
            <ul className="space-y-1">
              {entries.map((e, i) => (
                <li
                  key={`${e.t}-${i}`}
                  className="rounded-md border bg-card/60 px-ms-2 py-1.5 font-mono text-[11px] leading-snug"
                >
                  <div className="flex items-center gap-ms-2">
                    <span className="text-muted-foreground">{formatTime(e.t)}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${KIND_CLASS[e.kind]}`}>
                      {e.kind}
                    </span>
                    <span className="text-muted-foreground/70">{e.callId.slice(0, 8)}</span>
                  </div>
                  <div className="mt-0.5 break-words">{e.msg}</div>
                  {e.data && Object.keys(e.data).length ? (
                    <div className="mt-0.5 break-all text-muted-foreground">
                      {JSON.stringify(e.data)}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
