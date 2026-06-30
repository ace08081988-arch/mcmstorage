/**
 * Indikator progres langkah untuk kiriman lintas-channel yang masih in-flight.
 * Komponen dipakai oleh dialog pratinjau Chat dan WA dengan tampilan identik
 * supaya operator melihat status langkah (caption / foto i/N / link Maps)
 * dari kiriman channel lain tanpa harus pindah dialog.
 *
 * Sumber data: entri `send-log` untuk idempotency key yang sedang berjalan
 * (lihat `useLiveSendLog` di `@/lib/send-log`). Tidak ada state baru —
 * sinkronisasi mengandalkan event `send-log:changed` yang sudah dipancarkan
 * setiap kali `appendSendLog` dipanggil oleh pengirim aktif.
 */
import { CheckCircle2, Info, Loader2, TriangleAlert, XCircle } from "lucide-react";
import type { SendLogEntry } from "@/lib/send-log";

const MAX_VISIBLE = 6;

function fmtTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

export function InflightStepProgress({
  entries,
  channel,
}: {
  entries: SendLogEntry[];
  channel: "wa" | "chat" | "unknown";
}) {
  const terminal = entries.some((e) => e.kind === "outcome" || e.kind === "error");
  const visible = entries.slice(-MAX_VISIBLE);
  const channelLabel = channel === "wa" ? "WA" : channel === "chat" ? "Chat" : "channel lain";
  // Derive ringkas: hitung foto ok/fail dari label step (best-effort, tidak fatal).
  let photosOk = 0;
  let photosFail = 0;
  let photosTotal = 0;
  for (const e of entries) {
    const m = /(\d+)\s*\/\s*(\d+)/.exec(e.label);
    if (m) {
      const total = Number(m[2]);
      if (Number.isFinite(total) && total > photosTotal) photosTotal = total;
      if (e.kind === "step" && /terkirim/i.test(e.label)) photosOk += 1;
      else if (e.kind === "error" && /foto/i.test(e.label)) photosFail += 1;
    }
  }

  return (
    <section className="mt-2 rounded-md border border-amber-500/40 bg-background/70 p-2.5 text-[12px]">
      <header className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {terminal ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          )}
          <span>Progres langkah · {channelLabel}</span>
        </div>
        {photosTotal > 0 ? (
          <div className="text-[10.5px] font-mono text-muted-foreground">
            foto {photosOk}/{photosTotal}
            {photosFail > 0 ? <span className="ml-1 text-rose-600">({photosFail} gagal)</span> : null}
          </div>
        ) : null}
      </header>
      {visible.length === 0 ? (
        <p className="text-muted-foreground">Menunggu langkah pertama…</p>
      ) : (
        <ol className="space-y-1">
          {visible.map((e, i) => {
            const isLast = i === visible.length - 1;
            const running = isLast && !terminal && e.kind !== "error";
            const Icon =
              e.kind === "error"
                ? XCircle
                : e.kind === "outcome"
                ? TriangleAlert
                : e.kind === "info"
                ? Info
                : CheckCircle2;
            const tone =
              e.kind === "error"
                ? "text-rose-600 dark:text-rose-400"
                : e.kind === "outcome"
                ? "text-amber-600 dark:text-amber-400"
                : e.kind === "info"
                ? "text-muted-foreground"
                : "text-emerald-600 dark:text-emerald-400";
            return (
              <li key={`${e.at}-${i}`} className="flex items-start gap-2">
                {running ? (
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                ) : (
                  <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="break-words text-foreground/90">{e.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{fmtTime(e.at)}</span>
                  </div>
                  {e.detail ? (
                    <div className="break-words text-[10.5px] text-muted-foreground">{e.detail}</div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}