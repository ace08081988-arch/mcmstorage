import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Boxes,
  Calendar as CalendarIcon,
  ClipboardList,
  Download,
  Filter,
  LineChart,
  PackageCheck,
  ReceiptText,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Users,
  Warehouse,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fetchPiutangSummary } from "@/lib/piutang";
import { useOnDebtTx } from "@/lib/debt-tx-event";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dasbor — Ringkasan Bisnis Ace Storage" },
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
  const qc = useQueryClient();
  // Setiap transaksi hutang/piutang di layar lain langsung menyegarkan
  // ringkasan dashboard supaya angkanya tidak pernah tertinggal.
  useOnDebtTx(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: ["dashboard-summary-v1"] });
    }, [qc]),
  );
  return useQuery({
    queryKey: ["dashboard-summary-v1"],
    staleTime: 30_000,
    queryFn: async () => {
      const todayISO = startOfTodayISO();
      const weekAgoISO = startOfDayISO(6);

      // M10: konsolidasi query `salesToday` — dulu ada dua fetch terpisah ke
      // tabel `sales` (hari ini + minggu ini). Sekarang cukup satu fetch
      // minggu-terakhir dengan kolom lengkap (`total_revenue`, `cost_at_sale`,
      // `created_at`) lalu turunkan angka hari ini di klien. Menghilangkan
      // 1 round-trip Supabase per render dashboard dan menjamin angka
      // hari ini konsisten dengan sparkline minggu ini (SSOT tunggal).
      const [salesWeek, readyPending, piutangSummary, piutangCountRes, prepActive, recentSales] =
        await Promise.all([
          supabase
            .from("sales")
            .select("total_revenue, cost_at_sale, created_at")
            .gte("created_at", weekAgoISO)
            .order("created_at", { ascending: true }),
          supabase
            .from("ready_packages")
            .select("id", { count: "exact", head: true })
            .neq("status", "sent"),
          // H1: SSOT tunggal via RPC gabungan (sales-hutang + debts-piutang
          // dikurangi masing-masing pembayarannya). Menghilangkan drift
          // angka piutang antara Dashboard vs Gudang/Hutang-Piutang.
          fetchPiutangSummary(),
          supabase
            .from("debts")
            .select("id", { count: "exact", head: true })
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

      // Derivasi hari ini dari data minggu (SSOT tunggal untuk `sales`).
      const weekRows = (salesWeek.data ?? []) as Array<{
        total_revenue: number | null;
        cost_at_sale: number | null;
        created_at: string;
      }>;
      const todayRows = weekRows.filter((r) => r.created_at >= todayISO);
      const revenueToday = todayRows.reduce(
        (s, r) => s + (Number(r.total_revenue) || 0),
        0,
      );
      const profitToday = todayRows.reduce(
        (s, r) =>
          s + (Number(r.total_revenue) || 0) - (Number(r.cost_at_sale) || 0),
        0,
      );
      const piutangTotal = piutangSummary.total_outstanding;

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
      weekRows.forEach((r) => {
        const t = new Date(r.created_at);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const dayIdx = 6 - Math.floor((now.getTime() - new Date(t.setHours(0, 0, 0, 0)).getTime()) / 86400000);
        if (dayIdx >= 0 && dayIdx < 7) buckets[dayIdx].value += Number(r.total_revenue) || 0;
      });

      return {
        revenueToday,
        profitToday,
        salesTodayCount: todayRows.length,
        readyPendingCount: readyPending.count ?? 0,
        piutangTotal,
        piutangCount: piutangCountRes.count ?? 0,
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
    primary: "from-primary/20 via-primary/5 to-transparent text-primary",
    emerald: "from-success/20 via-success/5 to-transparent text-success dark:text-success",
    amber: "from-warning/20 via-warning/5 to-transparent text-warning dark:text-warning",
    sky: "from-sky-500/20 via-sky-500/5 to-transparent text-sky-600 dark:text-sky-400",
  };
  const inner = (
    <div
      className={cn(
        "group/card relative flex h-full flex-col gap-ms-3 overflow-hidden rounded-2xl border bg-card/80 p-ms-4 shadow-sm backdrop-blur-sm transition-all duration-300",
        "hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/30",
        "min-h-[124px]",
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br opacity-80",
          toneMap[tone],
        )}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-current opacity-[0.04] blur-2xl transition-all duration-500 group-hover/card:opacity-[0.09]"
      />
      <div className="relative flex items-start justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-background/80 shadow-sm ring-1 ring-border/70 backdrop-blur transition-transform duration-300 group-hover/card:scale-110 group-hover/card:rotate-3",
            toneMap[tone].split(" ").filter((c) => c.startsWith("text-")).join(" "),
          )}
        >
          <Icon className="h-4.5 w-4.5" />
        </span>
      </div>
      <div className="relative mt-auto">
        {loading ? (
          <div className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
        ) : (
          <div className="text-[1.55rem] font-bold leading-tight tracking-tight text-foreground tabular-nums">
            {value}
          </div>
        )}
        {hint ? (
          <div className="mt-1 text-ms-xs text-muted-foreground/90">{hint}</div>
        ) : null}
      </div>
      {href ? (
        <span className="relative inline-flex items-center gap-ms-1 text-ms-2xs font-semibold uppercase tracking-wider text-muted-foreground/80 transition-all group-hover/card:text-primary group-hover/card:translate-x-0.5">
          Buka <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5" />
        </span>
      ) : null}
    </div>
  );
  if (href) {
    return (
      <Link to={href} className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
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
      <div className="mt-1 flex justify-between text-ms-2xs text-muted-foreground">
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

// ---------------------------------------------------------------------------
// Executive report additions (additive; does not alter existing metrics)
// ---------------------------------------------------------------------------

type PeriodKey = "today" | "7d" | "30d" | "month" | "custom";

function toLocalYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function computePeriodRange(key: PeriodKey, customStart?: string, customEnd?: string) {
  const now = new Date();
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (key === "today") {
    // start already today 00:00
  } else if (key === "7d") {
    start.setDate(start.getDate() - 6);
  } else if (key === "30d") {
    start.setDate(start.getDate() - 29);
  } else if (key === "month") {
    start.setDate(1);
  } else if (key === "custom" && customStart && customEnd) {
    const s = new Date(customStart + "T00:00:00");
    const e = new Date(customEnd + "T23:59:59.999");
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
      return { start: s, end: e, label: `${toLocalYMD(s)} → ${toLocalYMD(e)}` };
    }
  }
  const labelMap: Record<PeriodKey, string> = {
    today: "Hari ini",
    "7d": "7 hari terakhir",
    "30d": "30 hari terakhir",
    month: `Bulan ${now.toLocaleDateString("id-ID", { month: "long" })}`,
    custom: "Kustom",
  };
  return { start, end, label: labelMap[key] };
}

function usePeriodReport(period: { start: Date; end: Date }) {
  const startISO = period.start.toISOString();
  const endISO = period.end.toISOString();
  return useQuery({
    queryKey: ["dashboard-period-report-v1", startISO, endISO],
    staleTime: 30_000,
    queryFn: async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [salesPeriod, salesMonth, inventory, customersTotal] = await Promise.all([
        supabase
          .from("sales")
          .select("id, total_revenue, cost_at_sale, qty_base, item_id, customer_id, created_at")
          .gte("created_at", startISO)
          .lte("created_at", endISO)
          .order("created_at", { ascending: false }),
        supabase
          .from("sales")
          .select("total_revenue")
          .gte("created_at", monthStart.toISOString()),
        supabase
          .from("warehouse_items")
          .select("id, name, stock_base, avg_cost_per_base"),
        supabase.from("customers").select("id", { count: "exact", head: true }),
      ]);

      const sales = salesPeriod.data ?? [];
      const revenuePeriod = sales.reduce((s, r: any) => s + (Number(r.total_revenue) || 0), 0);
      const profitPeriod = sales.reduce(
        (s, r: any) => s + (Number(r.total_revenue) || 0) - (Number(r.cost_at_sale) || 0),
        0,
      );
      const revenueMonth = (salesMonth.data ?? []).reduce(
        (s, r: any) => s + (Number(r.total_revenue) || 0),
        0,
      );
      const ordersPeriod = sales.length;
      const activeCustomers = new Set(
        sales.map((r: any) => r.customer_id).filter((v: unknown) => !!v),
      ).size;

      const items = inventory.data ?? [];
      const inventoryValue = items.reduce(
        (s, r: any) => s + (Number(r.stock_base) || 0) * (Number(r.avg_cost_per_base) || 0),
        0,
      );
      const itemNameById = new Map<string, string>();
      items.forEach((r: any) => itemNameById.set(r.id, r.name));

      // Top products by revenue in period
      const productAgg = new Map<string, { name: string; revenue: number; qty: number; orders: number }>();
      sales.forEach((r: any) => {
        const id = r.item_id as string | null;
        if (!id) return;
        const cur = productAgg.get(id) ?? {
          name: itemNameById.get(id) ?? "Produk",
          revenue: 0,
          qty: 0,
          orders: 0,
        };
        cur.revenue += Number(r.total_revenue) || 0;
        cur.qty += Number(r.qty_base) || 0;
        cur.orders += 1;
        productAgg.set(id, cur);
      });
      const topProducts = Array.from(productAgg.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      return {
        revenuePeriod,
        profitPeriod,
        revenueMonth,
        ordersPeriod,
        activeCustomers,
        inventoryValue,
        customersTotal: customersTotal.count ?? 0,
        topProducts,
        salesRows: sales,
      };
    },
  });
}

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Hari ini" },
  { key: "7d", label: "7 hari" },
  { key: "30d", label: "30 hari" },
  { key: "month", label: "Bulan ini" },
  { key: "custom", label: "Kustom" },
];

function ExecKpi({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof Sparkles;
  tone: "primary" | "emerald" | "amber" | "sky" | "violet" | "rose";
  loading?: boolean;
}) {
  const toneMap: Record<string, string> = {
    primary: "from-primary/15 to-transparent text-primary ring-primary/20",
    emerald: "from-success/15 to-transparent text-success dark:text-success ring-success/20",
    amber: "from-warning/15 to-transparent text-warning dark:text-warning ring-warning/20",
    sky: "from-sky-500/15 to-transparent text-sky-600 dark:text-sky-400 ring-sky-500/20",
    violet: "from-violet-500/15 to-transparent text-violet-600 dark:text-violet-400 ring-violet-500/20",
    rose: "from-rose-500/15 to-transparent text-rose-600 dark:text-rose-400 ring-rose-500/20",
  };
  return (
    <div className="group relative flex min-h-[112px] min-w-0 flex-col gap-ms-2 overflow-hidden rounded-2xl border bg-card/80 p-ms-4 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br", toneMap[tone])}
      />
      <div className="relative flex items-start justify-between gap-ms-2">
        <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground" title={label}>
          {label}
        </span>
        <span
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background/80 ring-1 shadow-sm backdrop-blur",
            toneMap[tone].split(" ").filter((c) => c.startsWith("text-") || c.startsWith("ring-")).join(" "),
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="relative mt-auto min-w-0">
        {loading ? (
          <div className="h-7 w-24 animate-pulse rounded-lg bg-muted" />
        ) : (
          // L6: nilai IDR bisa panjang di 411px 2-kolom — cegah overflow
          // dengan truncate + tooltip fallback, dan turunkan sedikit ukuran
          // di viewport terkecil agar tetap terbaca.
          <div
            className="truncate text-[1.05rem] font-bold leading-tight tracking-tight text-foreground tabular-nums sm:text-[1.35rem]"
            title={value}
          >
            {value}
          </div>
        )}
        {hint ? <div className="mt-0.5 truncate text-ms-2xs text-muted-foreground/90" title={hint}>{hint}</div> : null}
      </div>
    </div>
  );
}

function downloadCSV(filename: string, rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function DashboardPage() {
  const { data, isLoading } = useDashboardData();
  const now = useMemo(() => new Date(), []);
  const greeting = greetingFor(now.getHours());

  // Executive report state (additive; independent of existing summary above)
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [customStart, setCustomStart] = useState<string>(toLocalYMD(new Date()));
  const [customEnd, setCustomEnd] = useState<string>(toLocalYMD(new Date()));
  const range = useMemo(
    () => computePeriodRange(period, customStart, customEnd),
    [period, customStart, customEnd],
  );
  const { data: report, isLoading: reportLoading } = usePeriodReport({
    start: range.start,
    end: range.end,
  });

  const handleExportSales = () => {
    const rows: (string | number)[][] = [
      ["Tanggal", "Item ID", "Qty", "Harga", "Total", "HPP"],
      ...(report?.salesRows ?? []).map((r: any) => [
        new Date(r.created_at).toLocaleString("id-ID"),
        r.item_id ?? "",
        Number(r.qty_base) || 0,
        Number(r.price_per_base) || 0,
        Number(r.total_revenue) || 0,
        Number(r.cost_at_sale) || 0,
      ]),
    ];
    downloadCSV(`laporan-penjualan-${toLocalYMD(range.start)}_${toLocalYMD(range.end)}.csv`, rows);
  };
  const handleExportTopProducts = () => {
    const rows: (string | number)[][] = [
      ["Produk", "Pendapatan", "Kuantitas", "Transaksi"],
      ...(report?.topProducts ?? []).map((p) => [p.name, p.revenue, p.qty, p.orders]),
    ];
    downloadCSV(`top-produk-${toLocalYMD(range.start)}_${toLocalYMD(range.end)}.csv`, rows);
  };

  const revenueToday = data?.revenueToday ?? 0;
  const profitToday = data?.profitToday ?? 0;
  const salesTodayCount = data?.salesTodayCount ?? 0;
  const readyPendingCount = data?.readyPendingCount ?? 0;
  const piutangTotal = data?.piutangTotal ?? 0;
  const piutangCount = data?.piutangCount ?? 0;
  const prepActiveCount = data?.prepActiveCount ?? 0;
  const buckets = data?.weekBuckets ?? [];
  // M9: memoize agregasi buckets agar tidak dihitung ulang pada setiap render
  // (dashboard cukup banyak re-render karena state periode & tanggal kustom).
  const weekTotal = useMemo(
    () => buckets.reduce((s, b) => s + b.value, 0),
    [buckets],
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-ms-4 py-ms-4 sm:px-ms-6 sm:py-ms-6 space-ms-4 sm:space-ms-5 pb-24">
      {/* Header */}
      <header className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/12 via-background to-background p-ms-5 shadow-sm sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-primary/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-primary/5 blur-3xl"
        />
        <div className="relative flex flex-col gap-ms-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-ms-1.5 rounded-full border bg-background/80 px-ms-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground shadow-sm backdrop-blur">
              <Sparkles className="h-3 w-3 animate-pulse text-primary" />
              Ringkasan Hari Ini
            </div>
            <h1 className="mt-3 truncate bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-ms-2xl font-bold tracking-tight text-transparent sm:text-[2rem] sm:leading-[1.15]">
              {greeting}&nbsp;👋
            </h1>
            <p className="mt-1.5 text-ms-sm text-muted-foreground">
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
            className="group inline-flex shrink-0 items-center gap-ms-1.5 rounded-full border bg-background/90 px-ms-4 py-ms-2 text-ms-sm font-semibold shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary hover:text-primary-foreground hover:shadow-md"
          >
            Buka Beranda
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </header>

      {/* KPI grid */}
      <section
        aria-label="Ringkasan angka"
        className="grid grid-cols-2 gap-ms-3 sm:gap-ms-4 lg:grid-cols-4"
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
      <section className="grid gap-ms-4 sm:gap-ms-5 lg:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl border bg-card/80 p-ms-5 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md sm:p-ms-6 lg:col-span-2">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-3xl"
          />
          <div className="flex items-start justify-between gap-ms-3">
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Penjualan 7 hari terakhir
              </div>
              <div className="mt-1.5 text-[1.75rem] font-bold leading-tight tracking-tight tabular-nums">
                {isLoading ? (
                  <span className="inline-block h-8 w-36 animate-pulse rounded-lg bg-muted align-middle" />
                ) : (
                  IDR.format(weekTotal)
                )}
              </div>
            </div>
            <span className="inline-flex items-center gap-ms-1 rounded-full bg-primary/12 px-ms-3 py-1 text-ms-2xs font-semibold text-primary ring-1 ring-primary/20">
              <TrendingUp className="h-3 w-3" />
              {COMPACT.format(weekTotal)}
            </span>
          </div>
          <div className="relative mt-5">
            {isLoading ? (
              <div className="space-ms-2">
                <div className="h-16 w-full animate-pulse rounded-xl bg-muted" />
                <div className="flex justify-between">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <span key={i} className="h-2 w-6 animate-pulse rounded bg-muted/70" />
                  ))}
                </div>
              </div>
            ) : (
              <Sparkline points={buckets} />
            )}
          </div>
          <div className="relative mt-4 flex items-center gap-ms-2 text-ms-xs text-muted-foreground">
            <span className="inline-flex h-2 w-2 rounded-full bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]" />
            Total pendapatan per hari
          </div>
        </div>

        <div className="rounded-2xl border bg-card/80 p-ms-5 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md sm:p-ms-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Aktivitas terbaru
            </div>
            <Link
              to="/gudang"
              className="inline-flex items-center gap-0.5 text-ms-xs font-semibold text-primary transition-colors hover:text-primary/80"
            >
              Lihat semua <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {isLoading ? (
            <div className="space-ms-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-ms-3 rounded-xl p-ms-1">
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
                    <div className="h-2.5 w-20 animate-pulse rounded bg-muted/70" />
                  </div>
                  <div className="h-3 w-8 animate-pulse rounded bg-muted/60" />
                </div>
              ))}
            </div>
          ) : data?.recentSales.length ? (
            <ul className="-mx-1.5 space-y-1">
              {data.recentSales.map((s: any) => {
                const t = new Date(s.created_at);
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-ms-3 rounded-xl px-1.5 py-ms-2 transition-colors hover:bg-muted/50"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success/12 text-success ring-1 ring-success/20 dark:text-success">
                      <ReceiptText className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ms-sm font-semibold tabular-nums">
                        {IDR.format(Number(s.total_revenue) || 0)}
                      </div>
                      <div className="mt-0.5 text-ms-2xs text-muted-foreground">
                        {t.toLocaleString("id-ID", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <span className="rounded-md bg-muted/70 px-ms-2 py-0.5 text-ms-2xs font-medium text-muted-foreground tabular-nums">
                      ×{Number(s.qty_base || 0).toLocaleString("id-ID")}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-ms-2 rounded-xl border border-dashed p-8 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-muted/60 text-muted-foreground">
                <ReceiptText className="h-5 w-5" />
              </span>
              <div className="text-ms-sm font-medium">Belum ada aktivitas</div>
              <div className="text-ms-xs text-muted-foreground">
                Transaksi terbaru akan muncul di sini.
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Executive report (period-scoped, additive) */}
      <section aria-label="Laporan eksekutif" className="space-ms-4 sm:space-ms-5">
        <div className="flex flex-col gap-ms-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-ms-1.5 rounded-full border bg-background/80 px-ms-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground shadow-sm">
              <LineChart className="h-3 w-3 text-primary" />
              Laporan Eksekutif
            </div>
            <h2 className="mt-2 text-ms-lg font-bold tracking-tight sm:text-ms-xl">
              Kinerja bisnis · <span className="text-muted-foreground font-semibold">{range.label}</span>
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-ms-2">
            <button
              type="button"
              onClick={handleExportSales}
              disabled={reportLoading || (report?.salesRows.length ?? 0) === 0}
              className="inline-flex items-center gap-ms-1.5 rounded-full border bg-background px-ms-3 py-1.5 text-ms-xs font-semibold shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-background disabled:hover:text-foreground"
              aria-label="Ekspor CSV penjualan"
            >
              <Download className="h-3.5 w-3.5" /> CSV Penjualan
            </button>
            <button
              type="button"
              onClick={handleExportTopProducts}
              disabled={reportLoading || (report?.topProducts.length ?? 0) === 0}
              className="inline-flex items-center gap-ms-1.5 rounded-full border bg-background px-ms-3 py-1.5 text-ms-xs font-semibold shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-background disabled:hover:text-foreground"
              aria-label="Ekspor CSV top produk"
            >
              <Download className="h-3.5 w-3.5" /> CSV Top Produk
            </button>
          </div>
        </div>

        {/* Period filter chips — satu baris scroll, custom-date pakai popover overlay */}
        <div
          className="-mx-1 flex items-center gap-ms-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Rentang periode"
        >
          <span className="inline-flex shrink-0 items-center gap-ms-1 text-ms-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Filter className="h-3 w-3" /> Rentang
          </span>
          {PERIOD_OPTIONS.map((opt) => {
            const isActive = period === opt.key;
            const isCustom = opt.key === "custom";
            const btn = (
              <button
                key={opt.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setPeriod(opt.key)}
                className={cn(
                  "relative shrink-0 whitespace-nowrap text-ms-xs transition-colors",
                  isActive
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
                {isCustom && isActive && (customStart || customEnd) ? (
                  <span className="ml-ms-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary tabular-nums">
                    {customStart || "…"}→{customEnd || "…"}
                  </span>
                ) : null}
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-primary"
                  />
                ) : null}
              </button>
            );
            if (!isCustom) return btn;
            return (
              <Popover key={opt.key}>
                <PopoverTrigger asChild>{btn}</PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="bottom"
                  sideOffset={12}
                  collisionPadding={12}
                  avoidCollisions
                  className="z-50 w-[min(20rem,calc(100vw-1.5rem))] p-ms-3 shadow-lg"
                >
                  <div className="mb-ms-2 flex items-center gap-ms-1.5 text-ms-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <CalendarIcon className="h-3.5 w-3.5" /> Rentang custom
                  </div>
                  <div className="grid gap-ms-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                    <label className="grid gap-1">
                      <span className="text-ms-2xs text-muted-foreground">Dari</span>
                      <input
                        type="date"
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                        aria-label="Tanggal mulai"
                        className="w-full rounded border bg-background px-ms-2 py-1.5 text-ms-xs font-medium outline-none tabular-nums focus:ring-2 focus:ring-ring"
                      />
                    </label>
                    <span aria-hidden className="hidden text-ms-xs text-muted-foreground sm:block">→</span>
                    <label className="grid gap-1">
                      <span className="text-ms-2xs text-muted-foreground">Sampai</span>
                      <input
                        type="date"
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                        aria-label="Tanggal akhir"
                        className="w-full rounded border bg-background px-ms-2 py-1.5 text-ms-xs font-medium outline-none tabular-nums focus:ring-2 focus:ring-ring"
                      />
                    </label>
                  </div>
                </PopoverContent>
              </Popover>
            );
          })}
        </div>

        {/* Exec KPI grid */}
        <div className="grid grid-cols-2 gap-ms-3 sm:gap-ms-4 md:grid-cols-3 lg:grid-cols-6">
          <ExecKpi
            label="Pendapatan periode"
            value={IDR.format(report?.revenuePeriod ?? 0)}
            hint={range.label}
            icon={TrendingUp}
            tone="primary"
            loading={reportLoading}
          />
          <ExecKpi
            label="Pendapatan bulan ini"
            value={IDR.format(report?.revenueMonth ?? 0)}
            hint="Dari tanggal 1"
            icon={CalendarIcon}
            tone="sky"
            loading={reportLoading}
          />
          <ExecKpi
            label="Jumlah transaksi"
            value={String(report?.ordersPeriod ?? 0)}
            hint="Order di periode"
            icon={ReceiptText}
            tone="violet"
            loading={reportLoading}
          />
          <ExecKpi
            label="Keuntungan periode"
            value={IDR.format(report?.profitPeriod ?? 0)}
            hint={(report?.profitPeriod ?? 0) >= 0 ? "Estimasi kotor" : "Rugi periode"}
            icon={Sparkles}
            tone="emerald"
            loading={reportLoading}
          />
          <ExecKpi
            label="Nilai inventaris"
            value={IDR.format(report?.inventoryValue ?? 0)}
            hint="Stok × HPP rata-rata"
            icon={Warehouse}
            tone="amber"
            loading={reportLoading}
          />
          <ExecKpi
            label="Pelanggan aktif"
            value={String(report?.activeCustomers ?? 0)}
            hint={`Dari ${report?.customersTotal ?? 0} total`}
            icon={Users}
            tone="rose"
            loading={reportLoading}
          />
        </div>

        {/* Top products table */}
        <div className="relative overflow-hidden rounded-2xl border bg-card/80 shadow-sm backdrop-blur-sm">
          <div className="flex items-center justify-between border-b bg-muted/30 px-ms-4 py-ms-3 sm:px-ms-5">
            <div className="min-w-0">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Produk terlaris
              </div>
              <div className="mt-0.5 text-ms-sm font-semibold">Top 5 · {range.label}</div>
            </div>
            <span className="hidden shrink-0 items-center gap-ms-1 rounded-full bg-primary/10 px-ms-2.5 py-1 text-ms-2xs font-semibold text-primary ring-1 ring-primary/20 sm:inline-flex">
              <TrendingUp className="h-3 w-3" /> Berdasarkan pendapatan
            </span>
          </div>
          {reportLoading ? (
            <div className="space-ms-2 p-ms-4 sm:p-ms-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-ms-3">
                  <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-muted" />
                  <div className="h-3 flex-1 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-20 animate-pulse rounded bg-muted/70" />
                </div>
              ))}
            </div>
          ) : (report?.topProducts.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center gap-ms-2 p-8 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-muted/60 text-muted-foreground">
                <Boxes className="h-5 w-5" />
              </span>
              <div className="text-ms-sm font-medium">Belum ada penjualan</div>
              <div className="text-ms-xs text-muted-foreground">
                Tidak ada transaksi pada rentang {range.label.toLowerCase()}.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-ms-sm">
                <thead>
                  <tr className="border-b bg-muted/20 text-left text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <th scope="col" className="px-ms-4 py-ms-2.5 sm:px-ms-5">#</th>
                    <th scope="col" className="px-ms-4 py-ms-2.5">Produk</th>
                    <th scope="col" className="px-ms-4 py-ms-2.5 text-right tabular-nums">Pendapatan</th>
                    <th scope="col" className="hidden px-ms-4 py-ms-2.5 text-right tabular-nums sm:table-cell">Qty</th>
                    <th scope="col" className="hidden px-ms-4 py-ms-2.5 text-right tabular-nums sm:table-cell sm:px-ms-5">Trx</th>
                  </tr>
                </thead>
                <tbody>
                  {report!.topProducts.map((p, i) => (
                    <tr key={i} className="border-b last:border-b-0 transition-colors hover:bg-muted/30">
                      <td className="px-ms-4 py-ms-3 text-ms-xs font-semibold text-muted-foreground sm:px-ms-5">
                        {i + 1}
                      </td>
                      <td className="px-ms-4 py-ms-3">
                        <div className="truncate font-medium">{p.name}</div>
                      </td>
                      <td className="px-ms-4 py-ms-3 text-right font-semibold tabular-nums">
                        {IDR.format(p.revenue)}
                      </td>
                      <td className="hidden px-ms-4 py-ms-3 text-right tabular-nums text-muted-foreground sm:table-cell">
                        {p.qty.toLocaleString("id-ID")}
                      </td>
                      <td className="hidden px-ms-4 py-ms-3 text-right tabular-nums text-muted-foreground sm:table-cell sm:px-ms-5">
                        {p.orders}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Quick actions */}
      <section aria-label="Aksi cepat">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Aksi cepat
          </h2>
          {prepActiveCount > 0 ? (
            <span className="inline-flex items-center gap-ms-1 rounded-full bg-warning/12 px-ms-2.5 py-1 text-ms-2xs font-semibold text-warning ring-1 ring-warning/20 dark:text-warning">
              <ClipboardList className="h-3 w-3" />
              {prepActiveCount} tugas aktif
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-ms-3 sm:grid-cols-3 sm:gap-ms-4 lg:grid-cols-6">
          {QUICK_ACTIONS.map((a) => (
            <Link
              key={a.href}
              to={a.href}
              className={cn(
                "group relative flex flex-col gap-ms-2.5 overflow-hidden rounded-2xl border bg-card/80 p-ms-4 shadow-sm backdrop-blur-sm transition-all duration-300",
                "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg focus:outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/8 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
              />
              <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/15 transition-all duration-300 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground group-hover:shadow-md">
                <a.icon className="h-5 w-5" />
              </span>
              <div className="relative min-w-0">
                <div className="truncate text-ms-sm font-semibold tracking-tight">{a.title}</div>
                <div className="mt-0.5 line-clamp-2 text-ms-2xs leading-relaxed text-muted-foreground">
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