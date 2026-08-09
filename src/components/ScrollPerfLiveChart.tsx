import { useCallback, useEffect, useRef, useState } from "react";
import { Download, LineChart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { downloadCsv, scrollPerfCsvFilename } from "@/lib/scroll-perf-csv";
import {
  getScrollPerfMetrics,
  subscribeScrollPerf,
  subscribeScrollPerfEvents,
  type ScrollPerfEventKind,
} from "@/lib/scroll-perf";

/** Jumlah titik pada grafik (≈ 12 detik pada interval 100 ms). */
const POINTS = 120;
/** Jarak antar sampel grafik. */
const SAMPLE_MS = 100;

type Series = {
  fps: number[];
  lat: number[];
  scroll: boolean[];
  marks: ScrollPerfEventKind[][];
};

/** Warna & label penanda kejadian. */
const MARK_STYLE: Record<
  ScrollPerfEventKind,
  { color: string; label: string; short: string }
> = {
  touch: { color: "fill-sky-500", label: "Mulai menyentuh", short: "sentuh" },
  start: { color: "fill-primary", label: "Scroll dimulai", short: "mulai" },
  move: { color: "fill-amber-500", label: "Menggeser cepat", short: "geser" },
  stop: { color: "fill-muted-foreground", label: "Scroll berhenti", short: "berhenti" },
};

const MARK_ORDER: ScrollPerfEventKind[] = ["touch", "start", "move", "stop"];

/** Pilihan cepat rolling average (jumlah sampel; 1 = tanpa penghalusan). */
const SMOOTH_OPTIONS = [
  { v: 1, label: "Mentah", hint: "tanpa penghalusan" },
  { v: 5, label: "5", hint: "rata-rata 5 titik (±0,5 dtk)" },
  { v: 10, label: "10", hint: "rata-rata 10 titik (±1 dtk)" },
  { v: 20, label: "20", hint: "rata-rata 20 titik (±2 dtk)" },
] as const;

/** Batas ukuran rolling average yang boleh dipilih manual. */
const SMOOTH_MIN = 1;
const SMOOTH_MAX = 30;

/** Bulatkan & jepit nilai penghalusan ke rentang yang valid. */
function clampSmooth(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(SMOOTH_MAX, Math.max(SMOOTH_MIN, Math.round(v)));
}

const SMOOTH_KEY = "app-scroll-perf-smooth";
const SMOOTH_METHOD_KEY = "app-scroll-perf-smooth-method";

/** Metode penghalusan garis tren. */
type SmoothMethod = "sma" | "ema" | "median";

const METHOD_OPTIONS: {
  v: SmoothMethod;
  label: string;
  short: string;
  hint: string;
}[] = [
  {
    v: "sma",
    label: "Rata-rata",
    short: "SMA",
    hint: "Simple moving average — semua titik dalam jendela berbobot sama",
  },
  {
    v: "ema",
    label: "EMA",
    short: "EMA",
    hint: "Exponential moving average — titik terbaru berbobot lebih besar, reaksi lebih cepat",
  },
  {
    v: "median",
    label: "Median",
    short: "Median",
    hint: "Median bergerak — paling tahan terhadap spike ekstrem",
  },
];
const SPIKE_KEY = "app-scroll-perf-spike";

/**
 * Sensitivitas deteksi spike: seberapa jauh data mentah boleh menyimpang dari
 * garis tren sebelum ditandai. `rel` = selisih relatif terhadap tren,
 * `absFps` / `absLat` = ambang minimum absolut supaya riak kecil di nilai
 * rendah tidak ikut tertandai.
 */
const SPIKE_OPTIONS = [
  { v: 0, label: "Mati", hint: "tidak menyorot spike", rel: 0, absFps: 0, absLat: 0 },
  { v: 1, label: "Longgar", hint: "hanya lonjakan besar", rel: 0.45, absFps: 18, absLat: 25 },
  { v: 2, label: "Sedang", hint: "lonjakan sedang ke atas", rel: 0.3, absFps: 12, absLat: 15 },
  { v: 3, label: "Ketat", hint: "sensitif, tandai riak kecil", rel: 0.18, absFps: 7, absLat: 8 },
] as const;

/** Lebar jendela tren khusus deteksi (independen dari penghalusan tampilan). */
const SPIKE_WINDOW = 7;

/** Rata-rata bergerak (trailing) — memisahkan tren dari spike sesaat. */
function rolling(values: number[], window: number): number[] {
  if (window <= 1) return values;
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] ?? 0;
    if (i >= window) sum -= values[i - window] ?? 0;
    const n = Math.min(i + 1, window);
    out.push(Math.round((sum / n) * 10) / 10);
  }
  return out;
}

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
 * Tandai indeks yang menyimpang jauh dari garis tren.
 * FPS hanya dianggap spike saat *turun* (drop) — itu yang terasa sebagai lag;
 * latensi hanya saat *naik*.
 */
function detectSpikes(
  raw: number[],
  trend: number[],
  rel: number,
  abs: number,
  dir: "down" | "up",
): boolean[] {
  if (rel <= 0) return raw.map(() => false);
  return raw.map((v, i) => {
    const t = trend[i] ?? 0;
    if (t <= 0) return false;
    const delta = dir === "down" ? t - v : v - t;
    return delta >= Math.max(abs, t * rel);
  });
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
    marks: Array.from({ length: POINTS }, () => [] as ScrollPerfEventKind[]),
  });
  const [paused, setPaused] = useState(false);
  /** Lebar rolling average aktif (1 = mentah). */
  const [smooth, setSmooth] = useState(1);
  /** Sensitivitas sorotan spike (0 = mati). */
  const [spikeLevel, setSpikeLevel] = useState(2);
  /** Titik yang sedang ditunjuk (indeks sampel); null = tidak menunjuk. */
  const [hover, setHover] = useState<number | null>(null);
  const frames = useRef(0);
  const scrolledSinceSample = useRef(false);
  /** Kejadian yang terkumpul sejak sampel terakhir. */
  const pendingMarks = useRef<ScrollPerfEventKind[]>([]);
  // Saat menunjuk grafik, hentikan geseran data supaya angka yang dibaca
  // tidak bergerak di bawah jari/kursor.
  const hoverRef = useRef<number | null>(null);
  hoverRef.current = hover;

  // Pulihkan preferensi penghalusan.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SMOOTH_KEY);
      const raw = Number(stored);
      if (stored !== null && Number.isFinite(raw) && raw >= SMOOTH_MIN) {
        setSmooth(clampSmooth(raw));
      }
    } catch {
      /* mode privat → pakai default */
    }
  }, []);

  // Pulihkan preferensi sensitivitas spike.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SPIKE_KEY);
      const n = Number(raw);
      if (raw !== null && SPIKE_OPTIONS.some((o) => o.v === n)) setSpikeLevel(n);
    } catch {
      /* abaikan */
    }
  }, []);

  const chooseSpike = useCallback((v: number) => {
    setSpikeLevel(v);
    try {
      localStorage.setItem(SPIKE_KEY, String(v));
    } catch {
      /* abaikan */
    }
  }, []);

  const chooseSmooth = useCallback((v: number) => {
    const next = clampSmooth(v);
    setSmooth(next);
    try {
      localStorage.setItem(SMOOTH_KEY, String(next));
    } catch {
      /* abaikan */
    }
  }, []);

  // Tandai fase gulir agar arsiran grafik sinkron dengan interaksi.
  useEffect(() => {
    return subscribeScrollPerf(() => {
      if (getScrollPerfMetrics().scrolling) scrolledSinceSample.current = true;
    });
  }, []);

  // Kumpulkan penanda kejadian input (sentuh / mulai / geser / berhenti).
  useEffect(() => {
    return subscribeScrollPerfEvents((e) => {
      const list = pendingMarks.current;
      if (!list.includes(e.kind)) list.push(e.kind);
      if (list.length > 4) list.shift();
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
      const marks = pendingMarks.current;
      pendingMarks.current = [];
      setSeries((prev) => ({
        fps: [...prev.fps.slice(1), fps],
        lat: [...prev.lat.slice(1), scrolling ? m.latencyMs : 0],
        scroll: [...prev.scroll.slice(1), scrolling],
        marks: [...prev.marks.slice(1), marks],
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
  const fpsSmooth = rolling(series.fps, smooth);
  const latSmooth = rolling(series.lat, smooth);
  const smoothing = smooth > 1;

  // Deteksi spike selalu memakai garis tren sendiri (SPIKE_WINDOW) supaya
  // tetap bekerja meski tampilan grafik disetel "Mentah".
  const spikeCfg = SPIKE_OPTIONS.find((o) => o.v === spikeLevel) ?? SPIKE_OPTIONS[0];
  const fpsTrendRef = rolling(series.fps, SPIKE_WINDOW);
  const latTrendRef = rolling(series.lat, SPIKE_WINDOW);
  const fpsSpikes = detectSpikes(
    series.fps,
    fpsTrendRef,
    spikeCfg.rel,
    spikeCfg.absFps,
    "down",
  );
  const latSpikes = detectSpikes(
    series.lat,
    latTrendRef,
    spikeCfg.rel,
    spikeCfg.absLat,
    "up",
  );
  const spikeCount =
    fpsSpikes.filter(Boolean).length + latSpikes.filter(Boolean).length;

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
  const hoverMarks = hover !== null ? (series.marks[hover] ?? []) : [];
  const hoverFpsTrend = hover !== null ? (fpsSmooth[hover] ?? 0) : 0;
  const hoverLatTrend = hover !== null ? (latSmooth[hover] ?? 0) : 0;
  const hoverFpsSpike = hover !== null && (fpsSpikes[hover] ?? false);
  const hoverLatSpike = hover !== null && (latSpikes[hover] ?? false);
  const hoverFpsDrop =
    hover !== null ? Math.round((fpsTrendRef[hover] ?? 0) - (series.fps[hover] ?? 0)) : 0;
  const hoverLatJump =
    hover !== null ? Math.round((series.lat[hover] ?? 0) - (latTrendRef[hover] ?? 0)) : 0;
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
        {smoothing ? (
          <div className="text-muted-foreground tabular-nums">
            tren ({smooth} titik):{" "}
            {kind === "fps"
              ? `${hoverFpsTrend.toFixed(1)} fps`
              : `${hoverLatTrend.toFixed(1)} ms`}
          </div>
        ) : null}
        {hoverMarks.length ? (
          <div className="text-muted-foreground">
            {hoverMarks.map((k) => MARK_STYLE[k].short).join(" · ")}
          </div>
        ) : null}
        {(kind === "fps" ? hoverFpsSpike : hoverLatSpike) ? (
          <div className="font-medium text-red-500 tabular-nums">
            {kind === "fps"
              ? `spike: turun ${hoverFpsDrop} fps dari tren`
              : `spike: naik ${hoverLatJump} ms dari tren`}
          </div>
        ) : null}
      </div>
    );

  /** Sorotan spike: pita vertikal + titik merah pada indeks yang menyimpang. */
  const spikeOverlay = (flags: boolean[], values: number[], max: number) => (
    <g>
      {flags.map((on, i) =>
        on ? (
          <g key={i}>
            <rect
              x={Math.max(0, i * step - step / 2)}
              y={0}
              width={Math.max(2, step)}
              height={H}
              className="fill-red-500/15"
            />
            <circle
              cx={i * step}
              cy={H - Math.min(1, (values[i] ?? 0) / max) * H}
              r={2.6}
              className="fill-red-500"
            />
          </g>
        ) : null,
      )}
    </g>
  );

  /** Penanda kejadian di sepanjang sumbu waktu. */
  const markers = (
    <g>
      {series.marks.map((list, i) =>
        list.map((k, j) => (
          <g key={`${i}-${k}`}>
            <line
              x1={i * step}
              x2={i * step}
              y1={0}
              y2={H}
              className={
                k === "stop" ? "stroke-muted-foreground/30" : "stroke-foreground/20"
              }
              strokeWidth={1}
            />
            <circle
              cx={i * step}
              cy={3 + j * 6}
              r={2.2}
              className={MARK_STYLE[k].color}
            />
          </g>
        )),
      )}
    </g>
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
              Penghalusan membantu memisahkan tren dari spike sesaat.
              Titik yang menyimpang jauh dari tren otomatis disorot merah.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant="outline" className="text-muted-foreground">
              {hover !== null ? "Baca titik" : paused ? "Jeda" : "Live"}
            </Badge>
            {spikeCount > 0 ? (
              <Badge variant="outline" className="border-red-500/40 text-red-500">
                {spikeCount} spike
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="mt-ms-2 flex flex-wrap items-center justify-between gap-ms-2">
          <div
            className="inline-flex rounded-md border p-0.5"
            role="group"
            aria-label="Penghalusan grafik"
          >
            {SMOOTH_OPTIONS.map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => chooseSmooth(o.v)}
                aria-pressed={smooth === o.v}
                title={o.hint}
                className={`rounded-[5px] px-ms-2 py-1 text-ms-2xs transition-colors ${
                  smooth === o.v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-ms-2 text-ms-2xs text-muted-foreground">
            <span className="whitespace-nowrap">Rata-rata</span>
            <input
              type="range"
              min={SMOOTH_MIN}
              max={SMOOTH_MAX}
              step={1}
              value={smooth}
              onChange={(e) => chooseSmooth(Number(e.target.value))}
              aria-label="Ukuran rolling average (jumlah titik)"
              title={`Rata-rata ${smooth} titik`}
              className="h-1 w-24 cursor-pointer accent-primary"
            />
            <span className="tabular-nums">{smooth} titik</span>
          </label>
          <div
            className="inline-flex rounded-md border p-0.5"
            role="group"
            aria-label="Sensitivitas sorotan spike"
          >
            {SPIKE_OPTIONS.map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => chooseSpike(o.v)}
                aria-pressed={spikeLevel === o.v}
                title={o.hint}
                className={`rounded-[5px] px-ms-2 py-1 text-ms-2xs transition-colors ${
                  spikeLevel === o.v
                    ? "bg-red-500 text-white"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const now = Date.now();
              const rows = [
                "at,seconds_ago,fps,fps_trend,fps_spike,latency_ms,latency_trend,latency_spike,scrolling,events",
                ...series.fps.map((f, i) => {
                  const ago = ((POINTS - 1 - i) * SAMPLE_MS) / 1000;
                  const at = new Date(now - ago * 1000).toISOString();
                  const ev = (series.marks[i] ?? []).join("|");
                  return `${at},${ago.toFixed(1)},${f},${fpsSmooth[i] ?? f},${fpsSpikes[i] ? 1 : 0},${series.lat[i] ?? 0},${latSmooth[i] ?? 0},${latSpikes[i] ? 1 : 0},${series.scroll[i] ? 1 : 0},${ev}`;
                }),
              ].join("\r\n");
              downloadCsv(scrollPerfCsvFilename("live"), rows);
            }}
          >
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden />
            Ekspor CSV
          </Button>
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
            {markers}
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
            <path
              d={path(series.fps, 120, W, H)}
              className={smoothing ? "stroke-emerald-500/30" : "stroke-emerald-500"}
              fill="none"
              strokeWidth={1.5}
            />
            {smoothing ? (
              <path
                d={path(fpsSmooth, 120, W, H)}
                className="stroke-emerald-500"
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {spikeOverlay(fpsSpikes, series.fps, 120)}
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
            {markers}
            {series.lat.map((v, i) =>
              v > 0 ? (
                <rect
                  key={i}
                  x={i * step}
                  y={H - Math.min(1, v / latMax) * H}
                  width={Math.max(1.5, step * 0.8)}
                  height={Math.min(1, v / latMax) * H}
                  className={`${v > 40 ? "fill-red-500" : v > 20 ? "fill-amber-500" : "fill-sky-500"} ${smoothing ? "opacity-40" : ""}`}
                />
              ) : null,
            )}
            {smoothing ? (
              <path
                d={path(latSmooth, latMax, W, H)}
                className="stroke-sky-500"
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {spikeOverlay(latSpikes, series.lat, latMax)}
            {crosshair}
          </svg>
        </div>

        <div className="flex flex-wrap items-center gap-x-ms-3 gap-y-1 text-ms-2xs text-muted-foreground">
          {MARK_ORDER.map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <svg viewBox="0 0 8 8" className="h-2 w-2" aria-hidden>
                <circle cx={4} cy={4} r={4} className={MARK_STYLE[k].color} />
              </svg>
              {MARK_STYLE[k].label}
            </span>
          ))}
          {spikeLevel > 0 ? (
            <span className="inline-flex items-center gap-1 text-red-500">
              <svg viewBox="0 0 8 8" className="h-2 w-2" aria-hidden>
                <circle cx={4} cy={4} r={4} className="fill-red-500" />
              </svg>
              Spike (menyimpang dari tren)
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default ScrollPerfLiveChart;
