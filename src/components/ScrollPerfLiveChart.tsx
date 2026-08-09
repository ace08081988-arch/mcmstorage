import { useCallback, useEffect, useRef, useState } from "react";
import { LineChart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getScrollPerfMetrics, subscribeScrollPerf } from "@/lib/scroll-perf";

/** Jumlah titik pada grafik (≈ 12 detik pada interval 100 ms). */
const POINTS = 120;
/** Jarak antar sampel grafik. */
const SAMPLE_MS = 100;

type Series = { fps: number[]; lat: number[]; scroll: boolean[] };

function path(values: number[], max: number, w: number, h: number) {
  if (values.length < 2) return "";
  const step = w / (POINTS - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = h - Math.min(1, v / max) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Grafik waktu nyata FPS & latensi scroll.
 *
 * FPS diukur langsung dari loop `requestAnimationFrame` komponen ini (hanya
 * hidup selama halaman Diagnostik terbuka), latensi diambil dari metrik
 * scroll-perf setiap fase gulir dimulai. Area saat menggulir diarsir supaya
 * lonjakan terlihat jelas terhadap interaksi.
 */
export function ScrollPerfLiveChart() {
  const [series, setSeries] = useState<Series>({
    fps: Array(POINTS).fill(0),
    lat: Array(POINTS).fill(0),
    scroll: Array(POINTS).fill(false),
  });
  const [paused, setPaused] = useState(false);
  /** Titik yang sedang ditunjuk (indeks sampel); null = tidak menunjuk. */
  const [hover, setHover] = useState<number | null>(null);
  const frames = useRef(0);
  const scrolledSinceSample = useRef(false);
  // Saat menunjuk grafik, hentikan geseran data supaya angka yang dibaca
  // tidak bergerak di bawah jari/kursor.
  const hoverRef = useRef<number | null>(null);
  hoverRef.current = hover;

  // Tandai fase gulir agar arsiran grafik sinkron dengan interaksi.
  useEffect(() => {
    return subscribeScrollPerf(() => {
      if (getScrollPerfMetrics().scrolling) scrolledSinceSample.current = true;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    let timer = 0;
    let stopped = false;

    const tick = () => {
      frames.current += 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const sample = () => {
      if (stopped) return;
      const fps = Math.min(120, Math.round((frames.current * 1000) / SAMPLE_MS));
      frames.current = 0;
      const m = getScrollPerfMetrics();
      const scrolling = m.scrolling || scrolledSinceSample.current;
      scrolledSinceSample.current = false;
      if (hoverRef.current !== null) {
        timer = window.setTimeout(sample, SAMPLE_MS);
        return;
      }
      setSeries((prev) => ({
        fps: [...prev.fps.slice(1), fps],
        lat: [...prev.lat.slice(1), scrolling ? m.latencyMs : 0],
        scroll: [...prev.scroll.slice(1), scrolling],
      }));
      timer = window.setTimeout(sample, SAMPLE_MS);
    };
    timer = window.setTimeout(sample, SAMPLE_MS);

    // Jangan bakar baterai saat tab disembunyikan.
    const onVis = () => setPaused(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const W = 300;
  const H = 64;
  const fpsNow = series.fps[POINTS - 1] ?? 0;
  const latMax = Math.max(40, ...series.lat);
  const latNow = [...series.lat].reverse().find((v) => v > 0) ?? 0;

  const bands: { x: number; w: number }[] = [];
  const step = W / (POINTS - 1);
  let runStart = -1;
  series.scroll.forEach((on, i) => {
    if (on && runStart < 0) runStart = i;
    if ((!on || i === POINTS - 1) && runStart >= 0) {
      bands.push({ x: runStart * step, w: Math.max(step, (i - runStart) * step) });
      runStart = -1;
    }
  });

  const pick = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const i = Math.round(Math.min(1, Math.max(0, ratio)) * (POINTS - 1));
    setHover(i);
  }, []);
  const clear = useCallback(() => setHover(null), []);

  const hoverX = hover !== null ? hover * step : 0;
  /** Jarak waktu titik yang ditunjuk terhadap sekarang (detik). */
  const hoverAgo =
    hover !== null ? ((POINTS - 1 - hover) * SAMPLE_MS) / 1000 : 0;
  const hoverFps = hover !== null ? (series.fps[hover] ?? 0) : 0;
  const hoverLat = hover !== null ? (series.lat[hover] ?? 0) : 0;
  const hoverScroll = hover !== null ? (series.scroll[hover] ?? false) : false;
  /** Posisi kotak tooltip dalam persen lebar, dijaga agar tidak keluar kartu. */
  const hoverLeft = hover !== null ? Math.min(88, Math.max(2, (hover / (POINTS - 1)) * 100)) : 0;

  const tooltip = (kind: "fps" | "lat") =>
    hover === null ? null : (
      <div
        className="pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-2 py-1 text-[10px] leading-tight text-popover-foreground shadow-md"
        style={{ left: `${hoverLeft}%` }}
        role="status"
      >
        <div className="font-semibold tabular-nums">
          {kind === "fps"
            ? `${hoverFps} fps`
            : hoverLat > 0
              ? `${hoverLat} ms`
              : "tanpa latensi"}
        </div>
        <div className="text-muted-foreground tabular-nums">
          {hoverAgo === 0 ? "sekarang" : `${hoverAgo.toFixed(1)} dtk lalu`}
          {hoverScroll ? " · menggulir" : ""}
        </div>
      </div>
    );

  const crosshair =
    hover === null ? null : (
      <line
        x1={hoverX}
        x2={hoverX}
        y1={0}
        y2={H}
        className="stroke-foreground/50"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
    );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-ms-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <LineChart className="h-4 w-4 shrink-0" aria-hidden />
              Grafik waktu nyata
            </CardTitle>
            <CardDescription className="text-ms-xs">
              12 detik terakhir. Area berarsir = saat Anda menggulir. Sentuh atau
              arahkan kursor ke grafik untuk membaca nilai persis di titik itu.
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 text-muted-foreground">
            {hover !== null ? "Baca titik" : paused ? "Jeda" : "Live"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-ms-3">
        <div
          className="relative rounded-lg border p-ms-2 touch-none"
          onPointerDown={pick}
          onPointerMove={(e) => {
            if (e.pointerType === "touch" ? hover !== null : true) pick(e);
          }}
          onPointerUp={clear}
          onPointerLeave={clear}
          onPointerCancel={clear}
        >
          {tooltip("fps")}
          <div className="flex items-baseline justify-between">
            <span className="text-ms-2xs text-muted-foreground">FPS (0–120)</span>
            <span className="text-ms-sm font-semibold tabular-nums">{fpsNow}</span>
          </div>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="mt-1 h-16 w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label={`Grafik FPS waktu nyata, nilai terakhir ${fpsNow}`}
          >
            {bands.map((b, i) => (
              <rect key={i} x={b.x} y={0} width={b.w} height={H} className="fill-primary/10" />
            ))}
            {/* Garis acuan 60 fps */}
            <line
              x1={0}
              x2={W}
              y1={H - (60 / 120) * H}
              y2={H - (60 / 120) * H}
              className="stroke-border"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <path d={path(series.fps, 120, W, H)} className="stroke-emerald-500" fill="none" strokeWidth={1.5} />
            {crosshair}
            {hover !== null ? (
              <circle
                cx={hoverX}
                cy={H - Math.min(1, hoverFps / 120) * H}
                r={2.5}
                className="fill-emerald-500"
              />
            ) : null}
          </svg>
        </div>

        <div
          className="relative rounded-lg border p-ms-2 touch-none"
          onPointerDown={pick}
          onPointerMove={(e) => {
            if (e.pointerType === "touch" ? hover !== null : true) pick(e);
          }}
          onPointerUp={clear}
          onPointerLeave={clear}
          onPointerCancel={clear}
        >
          {tooltip("lat")}
          <div className="flex items-baseline justify-between">
            <span className="text-ms-2xs text-muted-foreground">
              Latensi scroll (0–{Math.round(latMax)} ms)
            </span>
            <span className="text-ms-sm font-semibold tabular-nums">
              {latNow ? `${latNow} ms` : "—"}
            </span>
          </div>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="mt-1 h-16 w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label={`Grafik latensi scroll waktu nyata, nilai terakhir ${latNow} milidetik`}
          >
            {bands.map((b, i) => (
              <rect key={i} x={b.x} y={0} width={b.w} height={H} className="fill-primary/10" />
            ))}
            {series.lat.map((v, i) =>
              v > 0 ? (
                <rect
                  key={i}
                  x={i * step}
                  y={H - Math.min(1, v / latMax) * H}
                  width={Math.max(1.5, step * 0.8)}
                  height={Math.min(1, v / latMax) * H}
                  className={v > 40 ? "fill-red-500" : v > 20 ? "fill-amber-500" : "fill-sky-500"}
                />
              ) : null,
            )}
            {crosshair}
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}

export default ScrollPerfLiveChart;
