/**
 * Dashboard ringkas: penjualan hari ini, jumlah pesanan per status, dan
 * estimasi piutang belum lunas. Semua angka memakai SSOT yang sama:
 * - penjualan hari ini  -> tabel `sales` (total_revenue)
 * - pesanan per status  -> `src/lib/orders-export.ts`
 * - piutang outstanding -> `piutang_summary_v1` via `src/lib/piutang.ts`
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RefreshCw, Wallet, ShoppingBag, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { rupiah } from "@/lib/stock-format";
import { fetchPiutangSummary } from "@/lib/piutang";
import { fetchOrdersExportData } from "@/lib/orders-export";

export const Route = createFileRoute("/_authenticated/ringkasan")({
  head: () => ({
    meta: [
      { title: "Ringkasan Harian · MCM Storage" },
      {
        name: "description",
        content:
          "Total penjualan hari ini, jumlah pesanan per status, dan estimasi piutang belum lunas dalam satu layar ringkas.",
      },
      { property: "og:title", content: "Ringkasan Harian · MCM Storage" },
      {
        property: "og:description",
        content: "Penjualan hari ini, pesanan per status, dan piutang belum lunas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RingkasanPage,
});

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const BAR_COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2, var(--primary)))"];

function useRingkasan() {
  return useQuery({
    queryKey: ["ringkasan-harian-v1"],
    staleTime: 30_000,
    queryFn: async () => {
      const [salesToday, orders, piutang] = await Promise.all([
        supabase
          .from("sales")
          .select("total_revenue, created_at")
          .gte("created_at", startOfTodayISO()),
        fetchOrdersExportData(),
        fetchPiutangSummary(),
      ]);

      const rows = (salesToday.data ?? []) as Array<{ total_revenue: number | null }>;
      const penjualanHariIni = rows.reduce((s, r) => s + (Number(r.total_revenue) || 0), 0);

      const perStatus = new Map<string, { jumlah: number; total: number; piutang: number }>();
      for (const s of orders.summary) {
        const key = `${s.kategori} · ${s.status}`;
        const cur = perStatus.get(key) ?? { jumlah: 0, total: 0, piutang: 0 };
        cur.jumlah += s.jumlah;
        cur.total += s.total;
        cur.piutang += s.piutang;
        perStatus.set(key, cur);
      }

      return {
        penjualanHariIni,
        trxHariIni: rows.length,
        piutangOutstanding: piutang.total_outstanding,
        totals: orders.totals,
        perStatus: [...perStatus.entries()].map(([label, v]) => ({ label, ...v })),
        generatedAt: new Date(),
      };
    },
  });
}

function StatCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {props.icon}
        <span className="truncate">{props.label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{props.value}</div>
      {props.hint ? (
        <div className="text-[11px] text-muted-foreground">{props.hint}</div>
      ) : null}
    </div>
  );
}

function RingkasanPage() {
  const { data, isLoading, isFetching, refetch } = useRingkasan();

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Ringkasan Harian</h1>
          <p className="text-xs text-muted-foreground">
            Penjualan hari ini, pesanan per status, dan piutang belum lunas.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={isFetching ? "size-4 animate-spin" : "size-4"} />
          <span className="ml-1 hidden sm:inline">Segarkan</span>
        </Button>
      </header>

      {isLoading || !data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <Skeleton className="h-56" />
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              icon={<ShoppingBag className="size-3.5" />}
              label="Penjualan hari ini"
              value={rupiah(data.penjualanHariIni)}
              hint={`${data.trxHariIni} transaksi`}
            />
            <StatCard
              icon={<ClipboardList className="size-3.5" />}
              label="Total pesanan"
              value={String(data.totals.jumlah)}
              hint={rupiah(data.totals.total)}
            />
            <StatCard
              icon={<Wallet className="size-3.5" />}
              label="Piutang belum lunas"
              value={rupiah(data.piutangOutstanding)}
              hint="SSOT piutang_summary_v1"
            />
          </section>

          <section className="rounded-xl border bg-card p-3">
            <h2 className="mb-2 text-sm font-medium">Jumlah pesanan per status</h2>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.perStatus}
                  margin={{ top: 4, right: 8, left: -20, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    interval={0}
                    angle={-18}
                    textAnchor="end"
                    height={54}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(v: number, _n, p) =>
                      [`${v} pesanan · ${rupiah(Number(p?.payload?.total) || 0)}`, "Jumlah"] as [
                        string,
                        string,
                      ]
                    }
                  />
                  <Bar dataKey="jumlah" radius={[6, 6, 0, 0]}>
                    {data.perStatus.map((row, i) => (
                      <Cell key={row.label} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-xl border bg-card p-3">
            <h2 className="mb-2 text-sm font-medium">Estimasi piutang per status</h2>
            <ul className="divide-y text-sm">
              {data.perStatus.map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate text-muted-foreground">{row.label}</span>
                  <span className="tabular-nums">{rupiah(row.piutang)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-2 py-1.5 font-medium">
                <span>Total piutang pesanan</span>
                <span className="tabular-nums">{rupiah(data.totals.piutang)}</span>
              </li>
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Dihitung {data.generatedAt.toLocaleString("id-ID")} ·{" "}
              <Link to="/ekspor-pesanan" className="underline">
                Ekspor rincian
              </Link>
            </p>
          </section>
        </>
      )}
    </main>
  );
}
