import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Download, History, Trash2 } from "lucide-react";
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
  clearScrollPerfSessions,
  listScrollPerfSessions,
  subscribeScrollPerfSessions,
  type ScrollPerfSession,
} from "@/lib/scroll-perf-sessions";
import {
  buildScrollPerfCsv,
  CSV_COLUMN_OPTIONS,
  downloadCsv,
  scrollPerfCsvFilename,
  type CsvColumns,
} from "@/lib/scroll-perf-csv";
import {
  clampSmooth,
  SMOOTH_METHOD_OPTIONS,
  type SmoothMethod,
} from "@/lib/scroll-perf-smooth";

const EMPTY: ScrollPerfSession[] = [];

const CSV_COLUMNS_KEY = "app-scroll-perf-csv-columns";
const SMOOTH_KEY = "app-scroll-perf-smooth";
const SMOOTH_METHOD_KEY = "app-scroll-perf-smooth-method";

function fmtTime(ms: number) {
  try {
    return new Date(ms).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fpsTone(fps: number) {
  if (!fps) return "text-muted-foreground";
  if (fps >= 50) return "text-emerald-500";
  if (fps >= 40) return "text-amber-500";
  return "text-red-500";
}

/** Riwayat ringkasan performa scroll per sesi (untuk perbandingan antar sesi). */
export function ScrollPerfHistoryCard() {
  const sessions = useSyncExternalStore(
    subscribeScrollPerfSessions,
    listScrollPerfSessions,
    () => EMPTY,
  );

  const best = sessions.reduce((a, s) => Math.max(a, s.fpsAvg), 0);

  /** Kolom yang ikut diekspor (mentah / tren / keduanya). */
  const [columns, setColumns] = useState<CsvColumns>("both");
  /** Parameter tren mengikuti preferensi grafik realtime. */
  const [window_, setWindow] = useState(5);
  const [method, setMethod] = useState<SmoothMethod>("sma");

  useEffect(() => {
    try {
      const c = localStorage.getItem(CSV_COLUMNS_KEY);
      if (c && CSV_COLUMN_OPTIONS.some((o) => o.v === c)) setColumns(c as CsvColumns);
      const w = Number(localStorage.getItem(SMOOTH_KEY));
      if (Number.isFinite(w) && w > 1) setWindow(clampSmooth(w));
      const m = localStorage.getItem(SMOOTH_METHOD_KEY);
      if (m && SMOOTH_METHOD_OPTIONS.some((o) => o.v === m)) setMethod(m as SmoothMethod);
    } catch {
      /* mode privat → pakai default */
    }
  }, []);

  const chooseColumns = useCallback((v: CsvColumns) => {
    setColumns(v);
    try {
      localStorage.setItem(CSV_COLUMNS_KEY, v);
    } catch {
      /* abaikan */
    }
  }, []);

  const exportSessions = (rows: ScrollPerfSession[], suffix?: string) => {
    downloadCsv(
      scrollPerfCsvFilename(suffix),
      buildScrollPerfCsv(rows, { columns, window: window_, method }),
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-ms-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <History className="h-4 w-4 shrink-0" aria-hidden />
              Riwayat per sesi
            </CardTitle>
            <CardDescription className="text-ms-xs">
              Ringkasan tiap kali aplikasi dibuka — bandingkan FPS, latensi, dan
              frame tersendat antar sesi, atau unduh time-series-nya sebagai CSV.
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 text-muted-foreground">
            {sessions.length} sesi
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-ms-3">
        {sessions.length === 0 ? (
          <p className="rounded-lg border border-dashed p-ms-3 text-ms-xs text-muted-foreground">
            Belum ada riwayat. Gulir halaman beberapa kali, ringkasannya tersimpan otomatis.
          </p>
        ) : (
          <ul className="space-y-ms-2">
            {sessions.map((s, i) => (
              <li key={s.id} className="rounded-lg border p-ms-2">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-ms-2">
                  <div className="min-w-0">
                    <p className="truncate text-ms-xs font-medium">
                      {fmtTime(s.startedAt)}
                      {i === 0 ? " · sesi ini" : ""}
                    </p>
                    <p className="truncate text-ms-2xs text-muted-foreground">
                      {s.device} · {s.phases} fase gulir
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-ms-1">
                    {s.fpsAvg > 0 && s.fpsAvg === best && sessions.length > 1 ? (
                      <Badge variant="outline" className="border-emerald-500/50 text-emerald-500">
                        Terbaik
                      </Badge>
                    ) : null}
                    <span className={`text-ms-base font-semibold tabular-nums ${fpsTone(s.fpsAvg)}`}>
                      {s.fpsAvg || "—"} fps
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => exportSessions([s], "sesi")}
                      aria-label={`Unduh CSV sesi ${fmtTime(s.startedAt)}`}
                      title="Unduh CSV sesi ini"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
                <dl className="mt-ms-2 grid grid-cols-4 gap-ms-1 text-center">
                  {[
                    { l: "FPS min", v: s.fpsMin ? `${s.fpsMin}` : "—" },
                    { l: "Latensi", v: s.latencyAvg ? `${s.latencyAvg} ms` : "—" },
                    { l: "Terburuk", v: s.latencyWorst ? `${s.latencyWorst} ms` : "—" },
                    { l: "Tersendat", v: `${s.jankTotal}` },
                  ].map((c) => (
                    <div key={c.l} className="rounded-md bg-muted/40 px-ms-1 py-ms-1">
                      <dt className="text-ms-2xs text-muted-foreground">{c.l}</dt>
                      <dd className="text-ms-xs font-medium tabular-nums">{c.v}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
        {sessions.length > 0 ? (
          <div className="flex flex-wrap items-center justify-end gap-ms-2">
            <div
              className="mr-auto inline-flex items-center gap-ms-2 text-ms-2xs text-muted-foreground"
            >
              <span className="whitespace-nowrap">Isi CSV</span>
              <div
                className="inline-flex rounded-md border p-0.5"
                role="group"
                aria-label="Kolom yang diekspor ke CSV"
              >
                {CSV_COLUMN_OPTIONS.map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => chooseColumns(o.v)}
                    aria-pressed={columns === o.v}
                    title={o.hint}
                    className={`rounded-[5px] px-ms-2 py-1 text-ms-2xs transition-colors ${
                      columns === o.v
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => exportSessions(sessions, "semua")}>
              <Download className="mr-1 h-3.5 w-3.5" aria-hidden />
              Ekspor CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => clearScrollPerfSessions()}>
              <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
              Hapus riwayat
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default ScrollPerfHistoryCard;
