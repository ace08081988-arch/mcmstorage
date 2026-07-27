/**
 * Audit Log Saldo Kontak.
 *
 * Menampilkan riwayat setiap perubahan saldo hutang/piutang per kontak —
 * lengkap dengan sumber update (kanal + tabel asal) dan timestamp — dari
 * SSOT yang sama dengan `party_balance_v1` (`party_balance_events_v1`).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, RefreshCw, Search, X } from "lucide-react";
import { rupiah } from "@/lib/stock-format";
import { useOnDebtTx } from "@/lib/debt-tx-event";
import {
  PARTY_AUDIT_QUERY_KEY,
  fetchPartyBalanceEvents,
  groupByParty,
  sourceLabel,
  type BalanceEvent,
} from "@/lib/party-balance-audit";

export const Route = createFileRoute("/_authenticated/audit-saldo")({
  head: () => ({
    meta: [
      { title: "Audit Saldo Kontak · MCM Storage" },
      {
        name: "description",
        content:
          "Riwayat perubahan saldo hutang & piutang per kontak beserta sumber update dan waktu kejadiannya.",
      },
      { property: "og:title", content: "Audit Saldo Kontak · MCM Storage" },
      {
        property: "og:description",
        content:
          "Telusuri asal angka saldo tiap kontak: kanal update, nominal, dan timestamp dari sumber data tunggal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditSaldoPage,
});

function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type KindFilter = "semua" | "hutang" | "piutang";

function AuditSaldoPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("semua");
  const [open, setOpen] = useState<string | null>(null);

  const query = useQuery({
    queryKey: PARTY_AUDIT_QUERY_KEY,
    queryFn: () => fetchPartyBalanceEvents(400),
    staleTime: 30_000,
  });

  useOnDebtTx(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: PARTY_AUDIT_QUERY_KEY });
    }, [qc]),
  );

  const groups = useMemo(() => {
    const events = (query.data ?? []).filter(
      (e) => kind === "semua" || e.kind === kind,
    );
    const all = groupByParty(events);
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((g) => g.key.includes(needle)) : all;
  }, [query.data, kind, q]);

  const totalEvents = groups.reduce((n, g) => n + g.events.length, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Audit Saldo Kontak</h1>
        <p className="text-xs text-muted-foreground">
          Riwayat perubahan saldo per kontak dari SSOT <code>party_balance_v1</code> —
          setiap baris menunjukkan sumber update, nominal, dan waktu kejadiannya.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link to="/hutang-piutang" className="text-primary underline">
          ← Hutang &amp; Piutang
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link to="/rekonsiliasi-piutang" className="text-primary underline">
          Rekonsiliasi piutang
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama kontak…"
            aria-label="Cari nama kontak"
            className="h-9 w-full rounded-lg border bg-background pl-7 pr-7 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Hapus kata kunci"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border px-3 text-xs hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
          {query.isFetching ? "Memuat…" : "Segarkan"}
        </button>
      </div>

      <div className="flex items-center gap-1">
        {(["semua", "piutang", "hutang"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-full border px-3 py-1 text-xs capitalize ${
              kind === k ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
            }`}
          >
            {k}
          </button>
        ))}
        <span className="ml-auto text-[0.6875rem] text-muted-foreground">
          {groups.length} kontak · {totalEvents} perubahan
        </span>
      </div>

      {query.isError && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          Gagal memuat audit: {(query.error as Error)?.message ?? "kesalahan tak dikenal"}
        </div>
      )}

      {query.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          Belum ada perubahan saldo yang cocok.
        </div>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => {
            const isOpen = open === g.key;
            return (
              <li key={g.key} className="overflow-hidden rounded-xl border bg-card">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : g.key)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start gap-2 p-3 text-left hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{g.name}</div>
                    <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                      Terakhir berubah {fmtTime(g.lastAt)} · {g.events.length} perubahan
                    </div>
                  </div>
                  <div className="shrink-0 space-y-0.5 text-right">
                    <div className="inline-flex items-center gap-1 text-xs tabular-nums text-emerald-600">
                      <ArrowDownCircle className="h-3 w-3" /> {rupiah(g.piutang)}
                    </div>
                    <div className="inline-flex items-center gap-1 text-xs tabular-nums text-rose-600">
                      <ArrowUpCircle className="h-3 w-3" /> {rupiah(g.hutang)}
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <ol className="border-t bg-background/50">
                    {g.events.map((e) => (
                      <EventRow key={`${e.sourceTable}-${e.refId}-${e.at}`} e={e} />
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[0.6875rem] text-muted-foreground">
        Saldo per kontak di atas dihitung dari kejadian yang sama dengan yang dipakai chip
        chat, kartu total, dan halaman Hutang &amp; Piutang. Maksimal 400 kejadian terbaru.
      </p>
    </div>
  );
}

function EventRow({ e }: { e: BalanceEvent }) {
  const naik = e.delta >= 0;
  return (
    <li className="flex items-start gap-2 border-b px-3 py-2 last:border-b-0">
      <span
        className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold capitalize ${
          e.kind === "piutang"
            ? "bg-emerald-500/12 text-emerald-600"
            : "bg-rose-500/12 text-rose-600"
        }`}
      >
        {e.kind}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{sourceLabel(e)}</div>
        <div className="text-[0.625rem] text-muted-foreground">
          {fmtTime(e.at)} · <code>{e.sourceTable}</code>
        </div>
        {e.note && (
          <div className="mt-0.5 line-clamp-2 text-[0.6875rem] text-muted-foreground">
            {e.note}
          </div>
        )}
      </div>
      <div
        className={`shrink-0 text-xs font-semibold tabular-nums ${
          naik ? "text-rose-600" : "text-emerald-600"
        }`}
      >
        {naik ? "+" : "−"}
        {rupiah(Math.abs(e.delta))}
      </div>
    </li>
  );
}