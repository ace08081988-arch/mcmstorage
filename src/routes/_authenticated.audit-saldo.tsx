/**
 * Audit Log Saldo Kontak.
 *
 * Menampilkan riwayat setiap perubahan saldo hutang/piutang per kontak —
 * lengkap dengan sumber update (kanal + tabel asal) dan timestamp — dari
 * SSOT yang sama dengan `party_balance_v1` (`party_balance_events_v1`).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { rupiah } from "@/lib/stock-format";
import { useOnDebtTx } from "@/lib/debt-tx-event";
import { useDebtSyncMap } from "@/lib/chat-debt-sync";
import {
  PARTY_AUDIT_QUERY_KEY,
  breakdownFactors,
  fetchPartyBalanceEvents,
  groupByParty,
  sourceLabel,
  summarizeDeltas,
  type BalanceEvent,
  type PartyDeltaSummary,
} from "@/lib/party-balance-audit";

export const Route = createFileRoute("/_authenticated/audit-saldo")({
  head: () => ({
    meta: [
      { title: "Audit Saldo Kontak · Ace Storage" },
      {
        name: "description",
        content:
          "Riwayat perubahan saldo hutang & piutang per kontak beserta sumber update dan waktu kejadiannya.",
      },
      { property: "og:title", content: "Audit Saldo Kontak · Ace Storage" },
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

type RankMode = "total" | "piutang" | "hutang" | "bayar";

const RANK_LABEL: Record<RankMode, string> = {
  total: "Pergerakan terbesar",
  piutang: "Piutang naik",
  hutang: "Hutang naik",
  bayar: "Pembayaran terbesar",
};

function rankScore(s: PartyDeltaSummary, mode: RankMode): number {
  switch (mode) {
    case "piutang":
      return s.piutangDelta;
    case "hutang":
      return s.hutangDelta;
    case "bayar":
      return s.turun;
    default:
      return Math.abs(s.piutangDelta) + Math.abs(s.hutangDelta);
  }
}

function rankSummaries(
  summaries: readonly PartyDeltaSummary[],
  mode: RankMode,
): PartyDeltaSummary[] {
  return summaries
    .filter((s) => rankScore(s, mode) > 0)
    .sort((a, b) => rankScore(b, mode) - rankScore(a, mode))
    .slice(0, 10);
}

/** Tanggal lokal (Asia/Jakarta) dalam format YYYY-MM-DD untuk perbandingan rentang. */
function localDay(iso: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(0, 10);
  }
}

function AuditSaldoPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("semua");
  const [open, setOpen] = useState<string | null>(null);
  const [openFactor, setOpenFactor] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rankBy, setRankBy] = useState<RankMode>("total");
  const [highlight, setHighlight] = useState<string | null>(null);

  const query = useQuery({
    queryKey: PARTY_AUDIT_QUERY_KEY,
    queryFn: () => fetchPartyBalanceEvents(400),
    staleTime: 30_000,
  });
  // Total saldo per kontak WAJIB berasal dari SSOT `party_balance_v1()` —
  // bukan dijumlahkan dari daftar kejadian. Agregasi event tidak bisa
  // menyamai SSOT karena SSOT meng-clamp tiap sumber (manual/sales/purchase)
  // secara terpisah, dan daftar kejadian dibatasi 400 baris terbaru.
  const ssot = useDebtSyncMap();

  useOnDebtTx(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: PARTY_AUDIT_QUERY_KEY });
    }, [qc]),
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (query.data ?? []).filter((e) => {
      if (kind !== "semua" && e.kind !== kind) return false;
      if (needle && !e.key.includes(needle)) return false;
      const d = localDay(e.at);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [query.data, kind, q, from, to]);

  const groups = useMemo(() => groupByParty(filtered), [filtered]);
  // Render bertahap: daftar kontak bisa panjang, jadi tampilkan 20 dulu
  // lalu tambah otomatis saat sentinel terlihat (infinite scroll).
  const [visible, setVisible] = useState(20);
  useEffect(() => {
    setVisible(20);
  }, [q, kind, from, to, rankBy]);
  const visibleGroups = useMemo(() => groups.slice(0, visible), [groups, visible]);
  const summaries = useMemo(() => summarizeDeltas(filtered), [filtered]);
  const totals = useMemo(
    () =>
      summaries.reduce(
        (acc, s) => {
          acc.piutangDelta += s.piutangDelta;
          acc.hutangDelta += s.hutangDelta;
          return acc;
        },
        { piutangDelta: 0, hutangDelta: 0 },
      ),
    [summaries],
  );
  const rangeActive = Boolean(from || to);

  const ranked = useMemo(() => rankSummaries(summaries, rankBy), [summaries, rankBy]);

  const focusParty = useCallback((key: string) => {
    setHighlight(key);
    setOpen(key);
    requestAnimationFrame(() => {
      document
        .getElementById(`audit-kontak-${key}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const totalEvents = groups.reduce((n, g) => n + g.events.length, 0);

  return (
    <div className="mx-auto w-full max-w-3xl px-ms-4 py-ms-4 sm:px-ms-6 sm:py-ms-6 space-ms-4 sm:space-ms-5 pb-24">
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

      <div className="rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[0.6875rem] text-muted-foreground">
            Dari tanggal
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 rounded-lg border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.6875rem] text-muted-foreground">
            Sampai tanggal
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 rounded-lg border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {rangeActive && (
            <button
              type="button"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
              className="h-9 rounded-lg border px-3 text-xs hover:bg-muted"
            >
              Semua tanggal
            </button>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg border bg-background/60 p-2">
            <div className="text-[0.625rem] text-muted-foreground">Delta bersih piutang</div>
            <div
              className={`text-sm font-semibold tabular-nums ${
                totals.piutangDelta >= 0 ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {totals.piutangDelta >= 0 ? "+" : "−"}
              {rupiah(Math.abs(totals.piutangDelta))}
            </div>
          </div>
          <div className="rounded-lg border bg-background/60 p-2">
            <div className="text-[0.625rem] text-muted-foreground">Delta bersih hutang</div>
            <div
              className={`text-sm font-semibold tabular-nums ${
                totals.hutangDelta >= 0 ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {totals.hutangDelta >= 0 ? "+" : "−"}
              {rupiah(Math.abs(totals.hutangDelta))}
            </div>
          </div>
        </div>

        {summaries.length > 0 && (
          <ul className="mt-3 divide-y border-t pt-1">
            {summaries.map((s) => {
              const isOpenFactor = openFactor === s.key;
              const evs = filtered.filter((e) => e.key === s.key);
              return (
                <li key={s.key} className="py-1.5">
                  <button
                    type="button"
                    onClick={() => setOpenFactor(isOpenFactor ? null : s.key)}
                    aria-expanded={isOpenFactor}
                    className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-muted/50"
                  >
                    <ChevronRight
                      className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
                        isOpenFactor ? "rotate-90" : ""
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{s.name}</div>
                      <div className="text-[0.625rem] text-muted-foreground">
                        {s.count} perubahan · naik {rupiah(s.naik)} · turun {rupiah(s.turun)}
                        <span className="ml-1 text-primary underline">
                          {isOpenFactor ? "tutup faktor" : "lihat faktor"}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 space-y-0.5 text-right text-[0.6875rem] tabular-nums">
                      {s.piutangDelta !== 0 && (
                        <div className={s.piutangDelta > 0 ? "text-rose-600" : "text-emerald-600"}>
                          Piutang {s.piutangDelta > 0 ? "+" : "−"}
                          {rupiah(Math.abs(s.piutangDelta))}
                        </div>
                      )}
                      {s.hutangDelta !== 0 && (
                        <div className={s.hutangDelta > 0 ? "text-rose-600" : "text-emerald-600"}>
                          Hutang {s.hutangDelta > 0 ? "+" : "−"}
                          {rupiah(Math.abs(s.hutangDelta))}
                        </div>
                      )}
                      {s.piutangDelta === 0 && s.hutangDelta === 0 && (
                        <div className="text-muted-foreground">Netral</div>
                      )}
                    </div>
                  </button>
                  {isOpenFactor && (
                    <FactorBreakdown
                      events={evs}
                      onOpenAll={() => {
                        setOpen(s.key);
                        document
                          .getElementById(`audit-kontak-${s.key}`)
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <section className="rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Peringkat kontak</h2>
          <span className="text-[0.625rem] text-muted-foreground">
            {rangeActive ? "rentang terpilih" : "semua tanggal"} · top {ranked.length}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {(["total", "piutang", "hutang", "bayar"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setRankBy(m)}
              aria-pressed={rankBy === m}
              className={`rounded-full border px-2.5 py-1 text-[0.6875rem] ${
                rankBy === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
              }`}
            >
              {RANK_LABEL[m]}
            </button>
          ))}
        </div>
        {ranked.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Belum ada kontak dengan perubahan pada kriteria ini.
          </p>
        ) : (
          <ol className="mt-2 space-y-1">
            {ranked.map((s, i) => {
              const score = rankScore(s, rankBy);
              const top = rankScore(ranked[0], rankBy) || 1;
              const isHi = highlight === s.key;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => focusParty(s.key)}
                    className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors ${
                      isHi ? "border-primary bg-primary/10" : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="w-5 shrink-0 text-center text-[0.625rem] font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{s.name}</span>
                      <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted">
                        <span
                          className={`block h-full ${
                            rankBy === "bayar" ? "bg-emerald-500" : "bg-primary"
                          }`}
                          style={{ width: `${Math.max((score / top) * 100, 3)}%` }}
                        />
                      </span>
                      <span className="mt-0.5 block text-[0.625rem] text-muted-foreground">
                        {s.count} perubahan · naik {rupiah(s.naik)} · turun {rupiah(s.turun)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold tabular-nums ${
                        rankBy === "bayar"
                          ? "text-emerald-600"
                          : score >= 0
                            ? "text-rose-600"
                            : "text-emerald-600"
                      }`}
                    >
                      {rupiah(Math.abs(score))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

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
          {visibleGroups.map((g) => {
            const isOpen = open === g.key;
            return (
              <li
                key={g.key}
                id={`audit-kontak-${g.key}`}
                className={`overflow-hidden rounded-xl border bg-card scroll-mt-4 transition-colors ${
                  highlight === g.key ? "border-primary ring-2 ring-primary/40" : ""
                }`}
              >
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
                    {(() => {
                      const bal = ssot.data?.get(g.key);
                      const piutang = bal ? bal.piutang : g.piutang;
                      const hutang = bal ? bal.hutang : g.hutang;
                      return (
                        <>
                          <div className="inline-flex items-center gap-1 text-xs tabular-nums text-emerald-600">
                            <ArrowDownCircle className="h-3 w-3" /> {rupiah(piutang)}
                          </div>
                          <div className="inline-flex items-center gap-1 text-xs tabular-nums text-rose-600">
                            <ArrowUpCircle className="h-3 w-3" /> {rupiah(hutang)}
                          </div>
                        </>
                      );
                    })()}
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

      {!query.isLoading && groups.length > 0 && (
        <InfiniteSentinel
          hasMore={visible < groups.length}
          loading={false}
          onLoadMore={() => setVisible((v) => v + 20)}
          doneLabel={`Semua kontak termuat (${groups.length})`}
        />
      )}

      <p className="text-[0.6875rem] text-muted-foreground">
        Total saldo per kontak di atas diambil langsung dari SSOT{" "}
        <code>party_balance_v1</code> — angkanya persis sama dengan chip chat, kartu total,
        dan halaman Hutang &amp; Piutang. Daftar kejadian di dalamnya dibatasi 400 perubahan
        terbaru, jadi saldo berjalan (sebelum → sesudah) hanya menelusuri rentang tersebut.
      </p>
    </div>
  );
}

function EventRow({ e }: { e: BalanceEvent }) {
  return <EventRowInner e={e} />;
}

function FactorBreakdown({
  events,
  onOpenAll,
}: {
  events: BalanceEvent[];
  onOpenAll: () => void;
}) {
  const factors = useMemo(() => breakdownFactors(events), [events]);
  const [openSrc, setOpenSrc] = useState<string | null>(null);
  if (factors.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1 rounded-lg border bg-background/60 p-2">
      <div className="text-[0.625rem] font-medium text-muted-foreground">
        Faktor penyebab perubahan
      </div>
      {factors.map((f) => {
        const id = `${f.sourceTable}::${f.source}`;
        const isOpen = openSrc === id;
        return (
          <div key={id} className="rounded-md border bg-card">
            <button
              type="button"
              onClick={() => setOpenSrc(isOpen ? null : id)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.6875rem] font-medium">{f.label}</div>
                <div className="text-[0.625rem] text-muted-foreground">
                  {f.count} transaksi · {f.share.toFixed(0)}% dampak ·{" "}
                  <code>{f.sourceTable}</code>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${f.delta >= 0 ? "bg-rose-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.max(f.share, 2)}%` }}
                  />
                </div>
              </div>
              <div
                className={`shrink-0 text-[0.6875rem] font-semibold tabular-nums ${
                  f.delta >= 0 ? "text-rose-600" : "text-emerald-600"
                }`}
              >
                {f.delta >= 0 ? "+" : "−"}
                {rupiah(Math.abs(f.delta))}
              </div>
            </button>
            {isOpen && (
              <ol className="border-t bg-background/50">
                {f.events.map((e) => (
                  <EventRowInner key={`${e.sourceTable}-${e.refId}-${e.at}`} e={e} />
                ))}
              </ol>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onOpenAll}
        className="w-full rounded-md border px-2 py-1 text-[0.625rem] text-primary hover:bg-muted"
      >
        Lihat semua transaksi kontak ini →
      </button>
    </div>
  );
}

function EventRowInner({ e }: { e: BalanceEvent }) {
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
        {e.balanceAfter !== undefined && (
          <div className="mt-1 inline-flex flex-wrap items-center gap-1 text-[0.625rem] tabular-nums text-muted-foreground">
            <span>Sebelum</span>
            <span className="rounded bg-muted px-1 py-0.5 font-medium text-foreground">
              {rupiah(Math.max(e.balanceBefore ?? 0, 0))}
            </span>
            <span aria-hidden>→</span>
            <span>Sesudah</span>
            <span className="rounded bg-muted px-1 py-0.5 font-semibold text-foreground">
              {rupiah(Math.max(e.balanceAfter, 0))}
            </span>
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