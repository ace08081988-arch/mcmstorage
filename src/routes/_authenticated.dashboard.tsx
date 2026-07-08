import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  ArrowUpRight,
  Boxes,
  ClipboardList,
  PackageCheck,
  ReceiptText,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dasbor — Ringkasan Bisnis MCM Storage" },
      {
        name: "description",
        content:
          "Ringkasan penjualan hari ini, pesanan siap kirim, piutang belum lunas, dan aktivitas terbaru dalam satu layar.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DashboardPage,
});

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const COMPACT = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function startOfDayISO(offsetDays: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString();
}
function greetingFor(hour: number) {
  if (hour < 11) return "Selamat pagi";
  if (hour < 15) return "Selamat siang";
  if (hour < 19) return "Selamat sore";
  return "Selamat malam";
}

/** Ambil semua data ringkasan sekali. Query di-cache oleh TanStack Query. */
function useDashboardData() {
  return useQuery({
    queryKey: ["dashboard-summary-v1"],
    staleTime: 30_000,
    queryFn: async () => {
      const todayISO = startOfTodayISO();
      const weekAgoISO = startOfDayISO(6);

      const [salesToday, salesWeek, readyPending, debtsPiutang, prepActive, recentSales] =
        await Promise.all([
          supabase
            .from("sales")
            .select("total_revenue, cost_at_sale")
            .gte("created_at", todayISO),
          supabase
            .from("sales")
            .select("total_revenue, created_at")
            .gte("created_at", weekAgoISO)
            .order("created_at", { ascending: true }),
          supabase
            .from("ready_packages")
            .select("id", { count: "exact", head: true })
            .neq("status", "sent"),
          supabase
            .from("debts")
            .select("amount")
            .eq("kind", "piutang"),
          supabase
            .from("prep_tasks")
            .select("id", { count: "exact", head: true })
            .in("status", ["active", "pending", "draft"]),
          supabase
            .from("sales")
            .select("id, total_revenue, created_at, qty_base")
            .order("created_at", { ascending: false })
            .limit(6),
        ]);

      const revenueToday = (salesToday.data ?? []).reduce(
        (s, r: any) => s + (Number(r.total_revenue) || 0),
        0,
      );
      const profitToday = (salesToday.data ?? []).reduce(
        (s, r: any) =>
          s + (Number(r.total_revenue) || 0) - (Number(r.cost_at_sale) || 0),
        0,
      );
      const piutangTotal = (debtsPiutang.data ?? []).reduce(
        (s, r: any) => s + (Number(r.amount) || 0),
        0,
      );

      // 7-day sparkline bucket by day (local time).
      const buckets: { label: string; value: number }[] = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - (6 - i));
        return {
          label: d.toLocaleDateString("id-ID", { weekday: "short" }),
          value: 0,
        };
      });
      (salesWeek.data ?? []).forEach((r: any) => {
        const t = new Date(r.created_at);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const dayIdx = 6 - Math.floor((now.getTime() - new Date(t.setHours(0, 0, 0, 0)).getTime()) / 86400000);
        if (dayIdx >= 0 && dayIdx < 7) buckets[dayIdx].value += Number(r.total_revenue) || 0;
      });

      return {
        revenueToday,
        profitToday,
        salesTodayCount: salesToday.data?.length ?? 0,
        readyPendingCount: readyPending.count ?? 0,
        piutangTotal,
        piutangCount: debtsPiutang.data?.length ?? 0,
        prepActiveCount: prepActive.count ?? 0,
        recentSales: recentSales.data ?? [],
        weekBuckets: buckets,
      };
    },
  });
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  loading,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof Sparkles;
  tone: "primary" | "emerald" | "amber" | "sky";
  loading?: boolean;
  href?: string;
}) {
  const toneMap: Record<string, string> = {
    primary: "from-primary/15 to-primary/0 text-primary",
    emerald: "from-emerald-500/15 to-emerald-500/0 text-emerald-600 dark:text-emerald-400",
    amber: "from-amber-500/15 to-amber-500/0 text-amber-600 dark:text-amber-400",
    sky: "from-sky-500/15 to-sky-500/0 text-sky-600 dark:text-sky-400",
  };
  const inner = (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-sm transition-all",
        "hover:shadow-md hover:-translate-y-0.5",
        "min-h-[112px]",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br opacity-70",
          toneMap[tone],
        )}
      />
      <div className="relative flex items-start justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-background/70 shadow-sm ring-1 ring-border",
            toneMap[tone].split(" ").filter((c) => c.startsWith("text-")).join(" "),
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="relative">
        {loading ? (
          <div className="h-7 w-24 animate-pulse rounded-md bg-muted" />
        ) : (
          <div className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
            {value}
          </div>
        )}
        {hint ? (
          <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </div>
      {href ? (
        <span className="relative ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          Buka <ArrowUpRight className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </div>
  );
  if (href) {
    return (
      <Link to={href} className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-2xl">
        {inner}
      </Link>
    );
  }
  return inner;
}

function Sparkline({ points }: { points: { label: string; value: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 100;
  const h = 36;
  const step = w / Math.max(1, points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = h - (p.value / max) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#sparkfill)" className="text-primary" />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        {points.map((p, i) => (
          <span key={i} className="tabular-nums">
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const QUICK_ACTIONS: {
  title: string;
  href: string;
  icon: typeof Sparkles;
  desc: string;
}[] = [
  { title: "Penyiapan Ecer", href: "/ecer", icon: PackageCheck, desc: "Kemas & kirim ke pelanggan" },
  { title: "POS Kasir Curah", href: "/pos-kasir", icon: ShoppingBag, desc: "Transaksi kasir langsung" },
  { title: "Gudang & Supplier", href: "/gudang", icon: Boxes, desc: "Stok, harga, pembelian" },
  { title: "Buat Tugas", href: "/tugas-baru", icon: ClipboardList, desc: "Tugas pegawai lapangan" },
  { title: "Hutang & Piutang", href: "/hutang-piutang", icon: Wallet, desc: "Catatan keuangan" },
  { title: "Notifikasi", href: "/notifikasi", icon: ReceiptText, desc: "Pemberitahuan terbaru" },
];

function DashboardPage() {
  const { data, isLoading } = useDashboardData();
  const now = useMemo(() => new Date(), []);
  const greeting = greetingFor(now.getHours());

  const revenueToday = data?.revenueToday ?? 0;
  const profitToday = data?.profitToday ?? 0;
  const salesTodayCount = data?.salesTodayCount ?? 0;
  const readyPendingCount = data?.readyPendingCount ?? 0;
  const piutangTotal = data?.piutangTotal ?? 0;
  const piutangCount = data?.piutangCount ?? 0;
  const prepActiveCount = data?.prepActiveCount ?? 0;
  const buckets = data?.weekBuckets ?? [];
  const weekTotal = buckets.reduce((s, b) => s + b.value, 0);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 pb-24 sm:p-6">
      {/* Header */}
      <header className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/10 via-background to-background p-5 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground backdrop-blur">
              <Sparkles className="h-3 w-3 text-primary" />
              Ringkasan Hari Ini
            </div>
            <h1 className="mt-3 truncate text-2xl font-bold tracking-tight sm:text-3xl">
              {greeting} 👋
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {now.toLocaleDateString("id-ID", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
          <Link
            to="/"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Buka Beranda <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* KPI grid */}
      <section
        aria-label="Ringkasan angka"
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      >
        <KpiCard
          label="Penjualan hari ini"
          value={IDR.format(revenueToday)}
          hint={`${salesTodayCount} transaksi`}
          icon={TrendingUp}
          tone="primary"
          loading={isLoading}
        />
        <KpiCard
          label="Keuntungan hari ini"
          value={IDR.format(profitToday)}
          hint={profitToday >= 0 ? "Estimasi kotor" : "Rugi hari ini"}
          icon={Sparkles}
          tone="emerald"
          loading={isLoading}
        />
        <KpiCard
          label="Siap kirim"
          value={String(readyPendingCount)}
          hint="Belum dikirim ke pelanggan"
          icon={PackageCheck}
          tone="sky"
          loading={isLoading}
          href="/ecer"
        />
        <KpiCard
          label="Piutang belum lunas"
          value={IDR.format(piutangTotal)}
          hint={`${piutangCount} tagihan`}
          icon={Wallet}
          tone="amber"
          loading={isLoading}
          href="/hutang-piutang"
        />
      </section>

      {/* Chart + activity */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Penjualan 7 hari terakhir
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums">
                {isLoading ? (
                  <span className="inline-block h-7 w-32 animate-pulse rounded bg-muted align-middle" />
                ) : (
                  IDR.format(weekTotal)
                )}
              </div>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
              {COMPACT.format(buckets.reduce((s, b) => s + b.value, 0))}
            </span>
          </div>
          <div className="mt-4">
            {isLoading ? (
              <div className="h-16 w-full animate-pulse rounded-lg bg-muted" />
            ) : (
              <Sparkline points={buckets} />
            )}
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex h-2 w-2 rounded-full bg-primary" />
            Total pendapatan per hari
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Aktivitas terbaru
            </div>
            <Link
              to="/gudang"
              className="text-xs font-medium text-primary hover:underline"
            >
              Lihat semua
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-20 animate-pulse rounded bg-muted/70" />
                  </div>
                </div>
              ))}
            </div>
          ) : data?.recentSales.length ? (
            <ul className="space-y-3">
              {data.recentSales.map((s: any) => {
                const t = new Date(s.created_at);
                return (
                  <li key={s.id} className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <ReceiptText className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {IDR.format(Number(s.total_revenue) || 0)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t.toLocaleString("id-ID", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {Number(s.qty_base || 0).toLocaleString("id-ID")}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Belum ada transaksi tercatat.
            </div>
          )}
        </div>
      </section>

      {/* Quick actions */}
      <section aria-label="Aksi cepat">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Aksi cepat
          </h2>
          {prepActiveCount > 0 ? (
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              {prepActiveCount} tugas aktif
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.href}
              to={a.href}
              className={cn(
                "group flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-sm transition-all",
                "hover:-translate-y-0.5 hover:shadow-md focus:outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <a.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{a.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                  {a.desc}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}