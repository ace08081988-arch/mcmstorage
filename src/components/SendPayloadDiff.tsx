import { useState } from "react";
import type { SendPayloadSummary } from "@/lib/idempotency";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Render perbedaan field-per-field antara payload kiriman sebelumnya
 * (dari record idempotency) dan payload yang akan dikirim sekarang.
 * Dipakai di banner "Klik ganda terdeteksi" pada dialog WA & Chat untuk
 * menjelaskan KENAPA tombol "Kirim ulang (paksa)" dinonaktifkan — yaitu
 * apa saja yang berubah pada caption / foto / lokasi / tujuan.
 */
export function SendPayloadDiff({
  previous,
  current,
}: {
  previous?: SendPayloadSummary | null;
  current?: SendPayloadSummary | null;
}) {
  const [open, setOpen] = useState(false);
  const rows = buildRows(previous ?? null, current ?? null);
  const changedCount = rows.filter((r) => r.changed).length;
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 rounded-md border border-rose-500/30 bg-background/60 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left font-medium text-rose-900 dark:text-rose-200"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-1">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Detail perbedaan payload
          <span className="ml-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold">
            {changedCount} berubah
          </span>
        </span>
        {!previous ? <span className="opacity-70">data sebelumnya tidak tersedia</span> : null}
      </button>
      {open ? (
        <div className="border-t border-rose-500/20 px-2 py-1.5">
          {!previous ? (
            <div className="text-rose-900/80 dark:text-rose-200/80">
              Sidik jari payload kiriman sebelumnya tidak tersimpan (record idempotency lama). Tidak ada
              data yang bisa dibandingkan — tutup dialog dan tunggu jeda idempotency selesai.
            </div>
          ) : (
            <dl className="grid grid-cols-1 gap-1.5">
              {rows.map((row) => (
                <div key={row.label} className="rounded border bg-card/60 p-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {row.label}
                    </dt>
                    <span
                      className={
                        "rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold " +
                        (row.changed
                          ? "bg-rose-500/15 text-rose-700 dark:text-rose-200"
                          : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200")
                      }
                    >
                      {row.changed ? "Berubah" : "Sama"}
                    </span>
                  </div>
                  {row.changed ? (
                    <dd className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                      <ValueBlock tone="prev" label="Sebelumnya" value={row.prev} />
                      <ValueBlock tone="curr" label="Sekarang" value={row.curr} />
                    </dd>
                  ) : (
                    <dd className="mt-1 break-words text-muted-foreground">{row.curr || <em className="opacity-60">(kosong)</em>}</dd>
                  )}
                </div>
              ))}
            </dl>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ValueBlock({ tone, label, value }: { tone: "prev" | "curr"; label: string; value: string }) {
  return (
    <div
      className={
        "rounded border px-1.5 py-1 " +
        (tone === "prev"
          ? "border-muted-foreground/20 bg-muted/40"
          : "border-amber-500/40 bg-amber-500/10")
      }
    >
      <div className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="whitespace-pre-wrap break-words text-[11px] text-foreground/90">
        {value ? value : <em className="opacity-60">(kosong)</em>}
      </div>
    </div>
  );
}

type Row = { label: string; prev: string; curr: string; changed: boolean };

function truncate(s: string, n = 240): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function buildRows(prev: SendPayloadSummary | null, curr: SendPayloadSummary | null): Row[] {
  if (!curr && !prev) return [];
  const fields: { key: keyof SendPayloadSummary; label: string; fmt: (v: unknown) => string }[] = [
    { key: "channel", label: "Channel", fmt: (v) => (v === "wa" ? "WhatsApp" : v === "chat" ? "Chat aplikasi" : "—") },
    { key: "destination", label: "Tujuan", fmt: (v) => (typeof v === "string" && v ? v : "—") },
    { key: "caption", label: "Caption", fmt: (v) => truncate(typeof v === "string" ? v : "") },
    { key: "photoCount", label: "Jumlah foto", fmt: (v) => `${typeof v === "number" ? v : 0} foto` },
    { key: "locationUrl", label: "Link lokasi", fmt: (v) => (typeof v === "string" && v ? truncate(v, 160) : "(tidak ada)") },
  ];
  const rows: Row[] = [];
  for (const f of fields) {
    const p = prev ? (prev as Record<string, unknown>)[f.key as string] : undefined;
    const c = curr ? (curr as Record<string, unknown>)[f.key as string] : undefined;
    // Lewati baris bila kedua sisi tidak punya nilai sama sekali.
    if (p === undefined && c === undefined) continue;
    const prevStr = f.fmt(p);
    const currStr = f.fmt(c);
    rows.push({ label: f.label, prev: prevStr, curr: currStr, changed: prevStr !== currStr });
  }
  return rows;
}