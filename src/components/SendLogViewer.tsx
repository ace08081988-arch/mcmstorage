import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Info, ListOrdered, XCircle } from "lucide-react";
import type { SendLogEntry } from "@/lib/send-log";

/**
 * Panel "Lihat log" untuk dialog pratinjau. Menampilkan urutan langkah dan
 * error dari kiriman sebelumnya berdasarkan idempotency key. Dibuat ringkas
 * (collapsible) agar tidak mengganggu pratinjau utama.
 */
export function SendLogViewer({ entries, defaultOpen = false }: { entries: SendLogEntry[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const errorCount = useMemo(() => entries.filter((e) => e.kind === "error" || /fail/i.test(e.label)).length, [entries]);
  if (!entries || entries.length === 0) return null;
  return (
    <section className="rounded-md border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] font-medium hover:bg-muted/50"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <ListOrdered className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1">Lihat log kiriman sebelumnya</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {entries.length} langkah{errorCount > 0 ? ` · ${errorCount} error` : ""}
        </span>
      </button>
      {open ? (
        <ol className="max-h-56 space-y-1 overflow-auto border-t bg-background/40 px-2.5 py-2 text-[11.5px]">
          {entries.map((e, i) => {
            const Icon = e.kind === "error" ? XCircle : e.kind === "outcome" ? AlertCircle : e.kind === "info" ? Info : CheckCircle2;
            const tone = e.kind === "error" ? "text-destructive" : e.kind === "outcome" ? "text-amber-600 dark:text-amber-400" : e.kind === "info" ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400";
            return (
              <li key={i} className="flex items-start gap-2">
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="break-words font-medium">{e.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {new Date(e.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>
                  {e.detail ? (
                    <pre className="mt-0.5 whitespace-pre-wrap break-words rounded bg-muted/60 p-1 font-mono text-[10.5px] text-muted-foreground">
                      {e.detail}
                    </pre>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}