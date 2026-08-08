import { useSyncExternalStore } from "react";
import { Activity, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getScrollPerfMetrics,
  resetScrollPerfMetrics,
  subscribeScrollPerf,
  type ScrollPerfMetrics,
} from "@/lib/scroll-perf";

const EMPTY: ScrollPerfMetrics = {
  fps: 0,
  fpsMin: 0,
  latencyMs: 0,
  latencyWorstMs: 0,
  jankFrames: 0,
  peakSpeed: 0,
  samples: 0,
  scrolling: false,
};

function tone(ok: boolean, warn: boolean) {
  if (warn) return "text-amber-500";
  return ok ? "text-emerald-500" : "text-red-500";
}

/** Metrik FPS & latensi scroll untuk halaman diagnostik. */
export function ScrollPerfCard() {
  const m = useSyncExternalStore(subscribeScrollPerf, getScrollPerfMetrics, () => EMPTY);

  const rows: { label: string; value: string; cls?: string; hint: string }[] = [
    {
      label: "FPS rata-rata",
      value: m.fps ? `${m.fps}` : "—",
      cls: m.fps ? tone(m.fps >= 50, m.fps >= 40 && m.fps < 50) : undefined,
      hint: "Gulir terakhir; 55–60 berarti mulus.",
    },
    {
      label: "FPS terendah",
      value: m.fpsMin ? `${m.fpsMin}` : "—",
      cls: m.fpsMin ? tone(m.fpsMin >= 40, m.fpsMin >= 25 && m.fpsMin < 40) : undefined,
      hint: "Frame paling lambat pada gulir terakhir.",
    },
    {
      label: "Latensi scroll",
      value: m.latencyMs ? `${m.latencyMs} ms` : "—",
      cls: m.latencyMs ? tone(m.latencyMs <= 20, m.latencyMs > 20 && m.latencyMs <= 40) : undefined,
      hint: "Jarak sentuhan pertama sampai frame pertama.",
    },
    {
      label: "Latensi terburuk",
      value: m.latencyWorstMs ? `${m.latencyWorstMs} ms` : "—",
      hint: "Nilai tertinggi sejak halaman dibuka.",
    },
    {
      label: "Frame tersendat",
      value: `${m.jankFrames}`,
      cls: m.jankFrames === 0 ? "text-emerald-500" : m.jankFrames <= 2 ? "text-amber-500" : "text-red-500",
      hint: "Frame di atas 33 ms pada gulir terakhir.",
    },
    {
      label: "Kecepatan puncak",
      value: m.peakSpeed ? `${m.peakSpeed} px/dtk` : "—",
      hint: "Seberapa cepat Anda mengusap.",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-ms-2">
          <div>
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <Activity className="h-4 w-4" aria-hidden />
              Performa scroll
            </CardTitle>
            <CardDescription className="text-ms-xs">
              Gulir halaman ini beberapa kali (pelan dan cepat), lalu lihat angkanya.
              Diukur langsung dari loop render aplikasi.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={m.scrolling ? "border-emerald-500/50 text-emerald-500" : "text-muted-foreground"}
          >
            {m.scrolling ? "Menggulir" : "Diam"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-ms-3">
        <dl className="grid grid-cols-2 gap-ms-2">
          {rows.map((r) => (
            <div key={r.label} className="rounded-lg border p-ms-2">
              <dt className="text-ms-2xs text-muted-foreground">{r.label}</dt>
              <dd className={`text-ms-base font-semibold tabular-nums ${r.cls ?? ""}`}>{r.value}</dd>
              <p className="mt-0.5 text-ms-2xs leading-ms-snug text-muted-foreground">{r.hint}</p>
            </div>
          ))}
        </dl>
        <div className="flex items-center justify-between gap-ms-2">
          <p className="text-ms-2xs text-muted-foreground">
            {m.samples > 0 ? `${m.samples} sesi gulir terukur` : "Belum ada sesi gulir terukur"}
          </p>
          <Button variant="outline" size="sm" onClick={() => resetScrollPerfMetrics()}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
            Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default ScrollPerfCard;
