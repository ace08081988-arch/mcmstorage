import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ChevronLeft, Gauge, HardDrive, RefreshCw, Timer, Zap } from "lucide-react";
import { PageContainer } from "@/components/shell";

export const Route = createFileRoute("/_authenticated/perf")({
  head: () => ({
    meta: [
      { title: "Monitor Performa · Ace Storage" },
      { name: "description", content: "Panel pemantauan performa aplikasi secara real-time: ukuran bundle, waktu render, FPS, memori, dan bottleneck (long task)." },
      { property: "og:title", content: "Monitor Performa · Ace Storage" },
      { property: "og:description", content: "Pantau ukuran bundle, waktu render, FPS, memori, dan bottleneck aplikasi secara real-time." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PerfPage,
});

type Bundle = { js: number; css: number; img: number; other: number; total: number; count: number; top: { name: string; size: number; ms: number }[] };
type Nav = { ttfb: number; domReady: number; load: number; fcp: number | null; lcp: number | null };
type LongTask = { at: number; ms: number; name: string };

const fmtKB = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} MB` : `${Math.round(b / 1024)} KB`);
const fmtMs = (n: number | null) => (n == null ? "—" : `${Math.round(n)} ms`);

function collectBundle(): Bundle {
  const empty: Bundle = { js: 0, css: 0, img: 0, other: 0, total: 0, count: 0, top: [] };
  if (typeof performance === "undefined" || !performance.getEntriesByType) return empty;
  const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const out = { ...empty, top: [] as Bundle["top"] };
  for (const r of res) {
    const size = r.encodedBodySize || r.transferSize || 0;
    const n = r.name.split("?")[0];
    if (/\.(m?js)$/.test(n)) out.js += size;
    else if (/\.css$/.test(n)) out.css += size;
    else if (/\.(png|jpe?g|webp|avif|gif|svg)$/.test(n)) out.img += size;
    else out.other += size;
    out.total += size;
    out.count++;
    out.top.push({ name: n.split("/").pop() || n, size, ms: r.duration });
  }
  out.top.sort((a, b) => b.size - a.size);
  out.top = out.top.slice(0, 8);
  return out;
}

function collectNav(): Nav {
  const nav = (performance.getEntriesByType?.("navigation")?.[0] ?? null) as PerformanceNavigationTiming | null;
  const paints = performance.getEntriesByType?.("paint") ?? [];
  const fcp = paints.find((p) => p.name === "first-contentful-paint")?.startTime ?? null;
  return {
    ttfb: nav ? nav.responseStart - nav.requestStart : 0,
    domReady: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
    load: nav ? nav.loadEventEnd - nav.startTime : 0,
    fcp,
    lcp: null,
  };
}

function Stat({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; tone?: "ok" | "warn" | "bad" }) {
  const toneCls = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-ms-3">
      <div className="flex items-center gap-ms-1.5 text-ms-2xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-ms-lg font-semibold tabular-nums ${toneCls}`}>{value}</div>
      {hint ? <div className="text-ms-2xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function PerfPage() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [nav, setNav] = useState<Nav | null>(null);
  const [lcp, setLcp] = useState<number | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [mem, setMem] = useState<{ used: number; limit: number } | null>(null);
  const [tasks, setTasks] = useState<LongTask[]>([]);
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const mountAt = useRef<number>(typeof performance !== "undefined" ? performance.now() : 0);

  const refresh = useCallback(() => {
    setBundle(collectBundle());
    setNav(collectNav());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (performance as any).memory;
    setMem(m ? { used: m.usedJSHeapSize, limit: m.jsHeapSizeLimit } : null);
  }, []);

  // Waktu render halaman ini (mount → paint berikutnya).
  useEffect(() => {
    const t = mountAt.current;
    requestAnimationFrame(() => setRenderMs(performance.now() - t));
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 2000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // LCP + long task observers.
  useEffect(() => {
    const obs: PerformanceObserver[] = [];
    const safeObserve = (type: string, cb: (list: PerformanceObserverEntryList) => void) => {
      try {
        const o = new PerformanceObserver(cb);
        o.observe({ type, buffered: true } as PerformanceObserverInit);
        obs.push(o);
      } catch {
        /* tipe tidak didukung browser ini */
      }
    };
    safeObserve("largest-contentful-paint", (l) => {
      const last = l.getEntries().at(-1);
      if (last) setLcp(last.startTime);
    });
    safeObserve("longtask", (l) => {
      const add = l.getEntries().map((e) => ({ at: Date.now(), ms: e.duration, name: e.name || "longtask" }));
      if (add.length) setTasks((prev) => [...add, ...prev].slice(0, 30));
    });
    return () => obs.forEach((o) => o.disconnect());
  }, []);

  // FPS meter.
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const slowest = bundle?.top.slice().sort((a, b) => b.ms - a.ms).slice(0, 5) ?? [];

  return (
    <PageContainer ariaLabel="Monitor performa">
      <div className="flex flex-wrap items-center gap-ms-2">
        <Link to="/" className="inline-flex h-8 items-center gap-ms-1 rounded-md border px-ms-2 text-ms-xs text-muted-foreground hover:bg-muted">
          <ChevronLeft className="h-3.5 w-3.5" /> Beranda
        </Link>
        <div className="flex items-center gap-ms-2">
          <Gauge className="h-4 w-4 text-primary" />
          <h1 className="text-ms-base font-semibold">Monitor Performa</h1>
        </div>
        <button
          onClick={refresh}
          className="ml-auto inline-flex h-8 items-center gap-ms-1 rounded-md bg-primary px-ms-3 text-ms-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Segarkan
        </button>
      </div>
      <p className="text-ms-xs text-muted-foreground">
        Data diambil langsung dari perangkat ini (Performance API) dan diperbarui tiap 2 detik. Tidak mengubah data aplikasi.
      </p>
      <p className="rounded-lg border border-dashed bg-muted/30 p-ms-2 text-ms-2xs text-muted-foreground">
        Analisis bundle (build-time): jalankan <code className="font-mono">bun run analyze</code> untuk peta treemap di{" "}
        <code className="font-mono">bundle-report/stats.html</code> + daftar chunk terberat,{" "}
        <code className="font-mono">bun run analyze:save</code> untuk mengunci baseline, lalu{" "}
        <code className="font-mono">bun run analyze:report</code> setelah perubahan untuk melihat selisih per chunk.
      </p>

      <section className="grid grid-cols-2 gap-ms-2 md:grid-cols-4">
        <Stat icon={<HardDrive className="h-3.5 w-3.5" />} label="Total transfer" value={bundle ? fmtKB(bundle.total) : "—"} hint={bundle ? `${bundle.count} resource` : undefined} />
        <Stat icon={<HardDrive className="h-3.5 w-3.5" />} label="JavaScript" value={bundle ? fmtKB(bundle.js) : "—"} tone={bundle && bundle.js > 1_500_000 ? "bad" : bundle && bundle.js > 800_000 ? "warn" : "ok"} />
        <Stat icon={<Timer className="h-3.5 w-3.5" />} label="Render halaman" value={fmtMs(renderMs)} hint="mount → frame" />
        <Stat icon={<Activity className="h-3.5 w-3.5" />} label="FPS" value={fps ? String(fps) : "—"} tone={fps && fps < 30 ? "bad" : fps && fps < 50 ? "warn" : "ok"} />
        <Stat icon={<Zap className="h-3.5 w-3.5" />} label="TTFB" value={fmtMs(nav?.ttfb ?? null)} />
        <Stat icon={<Zap className="h-3.5 w-3.5" />} label="FCP" value={fmtMs(nav?.fcp ?? null)} tone={nav?.fcp && nav.fcp > 3000 ? "warn" : "ok"} />
        <Stat icon={<Zap className="h-3.5 w-3.5" />} label="LCP" value={fmtMs(lcp)} tone={lcp && lcp > 4000 ? "bad" : lcp && lcp > 2500 ? "warn" : "ok"} />
        <Stat icon={<Activity className="h-3.5 w-3.5" />} label="Memori JS" value={mem ? fmtKB(mem.used) : "—"} hint={mem ? `limit ${fmtKB(mem.limit)}` : "tidak didukung"} />
      </section>

      <section className="rounded-xl border">
        <div className="border-b px-ms-3 py-ms-2 text-ms-xs font-medium">Aset terbesar (bundle)</div>
        <ul className="divide-y text-ms-xs">
          {(bundle?.top ?? []).map((r) => (
            <li key={r.name} className="flex items-center gap-ms-2 px-ms-3 py-1.5">
              <span className="truncate font-mono">{r.name}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">{Math.round(r.ms)} ms</span>
              <span className="w-20 text-right tabular-nums font-medium">{fmtKB(r.size)}</span>
            </li>
          ))}
          {!bundle?.top.length && <li className="px-ms-3 py-ms-3 text-muted-foreground">Belum ada data resource.</li>}
        </ul>
      </section>

      <section className="rounded-xl border">
        <div className="border-b px-ms-3 py-ms-2 text-ms-xs font-medium">Bottleneck</div>
        <div className="px-ms-3 py-ms-2 text-ms-2xs uppercase tracking-wide text-muted-foreground">Aset paling lambat dimuat</div>
        <ul className="divide-y text-ms-xs">
          {slowest.map((r) => (
            <li key={`s-${r.name}`} className="flex items-center gap-ms-2 px-ms-3 py-1.5">
              <span className="truncate font-mono">{r.name}</span>
              <span className="ml-auto tabular-nums font-medium">{Math.round(r.ms)} ms</span>
            </li>
          ))}
          {!slowest.length && <li className="px-ms-3 py-ms-2 text-muted-foreground">—</li>}
        </ul>
        <div className="border-t px-ms-3 py-ms-2 text-ms-2xs uppercase tracking-wide text-muted-foreground">
          Long task (&gt;50 ms) — {tasks.length} terdeteksi
        </div>
        <ul className="max-h-56 divide-y overflow-auto text-ms-xs">
          {tasks.map((t, i) => (
            <li key={`${t.at}-${i}`} className="flex items-center gap-ms-2 px-ms-3 py-1.5">
              <span className="tabular-nums text-muted-foreground">{new Date(t.at).toLocaleTimeString("id-ID")}</span>
              <span className="truncate font-mono">{t.name}</span>
              <span className={`ml-auto tabular-nums font-medium ${t.ms > 200 ? "text-destructive" : ""}`}>{Math.round(t.ms)} ms</span>
            </li>
          ))}
          {!tasks.length && (
            <li className="px-ms-3 py-ms-2 text-muted-foreground">Belum ada long task terdeteksi (atau tidak didukung browser ini).</li>
          )}
        </ul>
      </section>
    </PageContainer>
  );
}
