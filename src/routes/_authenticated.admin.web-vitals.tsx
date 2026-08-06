/**
 * Laporan Core Web Vitals lapangan (RUM) untuk halaman katalog publik.
 * Menampilkan p75 per metrik, perbandingan sebelum vs sesudah antara dua
 * jendela waktu sepanjang periode yang dipilih, dan tren harian.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Gauge, RefreshCw, ShieldAlert } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAdminStatus } from "@/hooks/use-is-admin";
import { Button } from "@/components/ui/button";
import { WebVitalsAlertsPanel } from "@/components/WebVitalsAlertsPanel";
import {
  getWebVitalsReport,
  type VitalsMetric,
  type VitalsPage,
  type VitalsReport,
} from "@/lib/web-vitals.functions";

export const Route = createFileRoute("/_authenticated/admin/web-vitals")({
  head: () => ({
    meta: [
      { title: "Core Web Vitals Katalog · Ace Storage" },
      {
        name: "description",
        content:
          "Pemantauan LCP, CLS, dan INP halaman katalog publik beserta tren sebelum-sesudah optimasi.",
      },
    ],
  }),
  component: WebVitalsPage,
});

/** Ambang resmi Google: [baik, perlu perbaikan]. */
const THRESHOLD: Record<VitalsMetric, [number, number]> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  TTFB: [800, 1800],
  FCP: [1800, 3000],
};

function fmt(metric: VitalsMetric, v: number | null): string {
  if (v == null) return "—";
  if (metric === "CLS") return v.toFixed(3);
  return `${(v / 1000).toFixed(2)} s`;
}

function ratingClass(metric: VitalsMetric, v: number | null): string {
  if (v == null) return "text-muted-foreground";
  const [good, ni] = THRESHOLD[metric];
  if (v <= good) return "text-primary";
  if (v <= ni) return "text-amber-500";
  return "text-destructive";
}

function delta(metric: VitalsMetric, before: number | null, after: number | null) {
  if (before == null || after == null || before === 0) return null;
  const pct = ((after - before) / before) * 100;
  return {
    pct,
    // Semua metrik CWV: makin kecil makin baik.
    better: after < before,
    label: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`,
  };
}

function WebVitalsPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const fetchReport = useServerFn(getWebVitalsReport);
  const [page, setPage] = useState<VitalsPage>("katalog_list");
  const [days, setDays] = useState(7);
  const [device, setDevice] = useState<"all" | "mobile" | "desktop">("all");
  const [data, setData] = useState<VitalsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchReport({ data: { page, days, device } });
      setData(res);
      if (!res.isAdmin) setErr("Akses ditolak");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, page, days, device]);

  const chart = useMemo(() => {
    const rows = new Map<string, Record<string, number | string>>();
    for (const d of data?.daily ?? []) {
      const row = rows.get(d.day) ?? { day: d.day.slice(5) };
      // CLS diskalakan x1000 agar satu sumbu Y cukup untuk semua metrik.
      row[d.metric] = d.metric === "CLS" ? d.p75 * 1000 : d.p75;
      rows.set(d.day, row);
    }
    return [...rows.values()];
  }, [data]);

  if (isCheckingAdmin) {
    return <p className="p-6 text-sm text-muted-foreground">Memeriksa akses…</p>;
  }
  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <h1 className="mt-2 text-lg font-semibold">Akses ditolak</h1>
        <p className="text-sm text-muted-foreground">Halaman ini khusus admin.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-5">
      <Link
        to="/"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Kembali
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Gauge className="h-5 w-5 text-primary" aria-hidden /> Core Web Vitals katalog
          </h1>
          <p className="text-sm text-muted-foreground">
            Diukur dari perangkat pengunjung asli (p75), bukan simulasi.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden />
          Muat ulang
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ["katalog_list", "Halaman katalog"],
            ["katalog_detail", "Detail produk"],
          ] as const
        ).map(([v, label]) => (
          <Button
            key={v}
            size="sm"
            variant={page === v ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setPage(v)}
          >
            {label}
          </Button>
        ))}
        {([7, 14, 30] as const).map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setDays(d)}
          >
            {d} hari
          </Button>
        ))}
        {(
          [
            ["all", "Semua"],
            ["mobile", "HP"],
            ["desktop", "Desktop"],
          ] as const
        ).map(([v, label]) => (
          <Button
            key={v}
            size="sm"
            variant={device === v ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setDevice(v)}
          >
            {label}
          </Button>
        ))}
      </div>

      {err ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {err}
        </p>
      ) : null}

      {data && data.totalSamples === 0 ? (
        <div className="lux-card mt-4 p-5 text-sm text-muted-foreground">
          Belum ada data pengukuran untuk periode ini. Data terkumpul otomatis begitu
          pengunjung membuka halaman katalog publik.
        </div>
      ) : null}

      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(data?.after ?? []).map((stat) => {
          const prev = data?.before.find((b) => b.metric === stat.metric) ?? null;
          const d = delta(stat.metric, prev?.p75 ?? null, stat.p75);
          return (
            <article key={stat.metric} className="lux-card p-4">
              <p className="lux-eyebrow">{stat.metric} · p75</p>
              <p className={`text-2xl font-semibold ${ratingClass(stat.metric, stat.p75)}`}>
                {fmt(stat.metric, stat.p75)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sebelum: {fmt(stat.metric, prev?.p75 ?? null)}
                {d ? (
                  <span className={d.better ? "text-primary" : "text-destructive"}>
                    {" "}
                    · {d.label} {d.better ? "lebih cepat" : "lebih lambat"}
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {stat.samples} sampel ·{" "}
                {stat.goodRatio == null ? "—" : `${Math.round(stat.goodRatio * 100)}% "baik"`}
              </p>
            </article>
          );
        })}
      </section>

      {chart.length > 1 ? (
        <section className="lux-card mt-4 p-4">
          <h2 className="text-sm font-semibold">Tren harian (p75)</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            LCP/INP/TTFB dalam milidetik; CLS diskalakan ×1000.
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="LCP" stroke="hsl(var(--primary))" dot={false} />
                <Line type="monotone" dataKey="INP" stroke="hsl(var(--muted-foreground))" dot={false} />
                <Line type="monotone" dataKey="CLS" stroke="hsl(var(--destructive))" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      <WebVitalsAlertsPanel />
    </main>
  );
}