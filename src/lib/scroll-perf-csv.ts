/**
 * Ekspor time-series performa scroll (FPS & latensi) ke CSV.
 *
 * Satu baris = satu fase gulir yang terukur pada sebuah sesi, sehingga bisa
 * dianalisis di spreadsheet atau alat lain di luar aplikasi.
 */
import type { ScrollPerfSession } from "./scroll-perf-sessions";
import {
  clampSmooth,
  smoothMethodShort,
  smoothSeries,
  type SmoothMethod,
} from "./scroll-perf-smooth";

/** Kolom yang ikut diekspor: data mentah, garis tren, atau keduanya. */
export type CsvColumns = "raw" | "trend" | "both";

export const CSV_COLUMN_OPTIONS: {
  v: CsvColumns;
  label: string;
  hint: string;
}[] = [
  { v: "raw", label: "Mentah", hint: "hanya nilai terukur apa adanya" },
  { v: "trend", label: "Tren", hint: "hanya nilai yang sudah dihaluskan" },
  { v: "both", label: "Keduanya", hint: "mentah + tren berdampingan" },
];

export type ScrollPerfCsvOptions = {
  /** Kolom yang disertakan (default: keduanya). */
  columns?: CsvColumns;
  /** Ukuran jendela penghalusan untuk kolom tren. */
  window?: number;
  /** Metode penghalusan untuk kolom tren. */
  method?: SmoothMethod;
};

const BASE_HEADERS = [
  "session_id",
  "session_started_at",
  "device",
  "sample_index",
  "sample_at",
  "seconds_since_session_start",
];

const RAW_HEADERS = ["fps", "fps_min", "latency_ms", "jank_frames", "peak_speed_px_s"];
const TREND_HEADERS = ["fps_trend", "latency_trend", "trend_method", "trend_window"];

function cell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function iso(ms: number): string {
  try {
    return new Date(ms).toISOString();
  } catch {
    return "";
  }
}

/** Susun isi CSV dari satu atau beberapa sesi. */
export function buildScrollPerfCsv(
  sessions: ScrollPerfSession[],
  options: ScrollPerfCsvOptions = {},
): string {
  const columns: CsvColumns = options.columns ?? "both";
  const window = clampSmooth(options.window ?? 5);
  const method: SmoothMethod = options.method ?? "sma";
  const withRaw = columns !== "trend";
  const withTrend = columns !== "raw";
  const methodLabel = window > 1 ? smoothMethodShort(method) : "raw";

  const rows: string[] = [
    [
      ...BASE_HEADERS,
      ...(withRaw ? RAW_HEADERS : []),
      ...(withTrend ? TREND_HEADERS : []),
    ].join(","),
  ];
  sessions.forEach((s) => {
    const samples = s.samples ?? [];
    if (samples.length === 0) {
      // Sesi lama tanpa time-series → tetap ekspor ringkasannya satu baris.
      rows.push(
        [
          s.id,
          iso(s.startedAt),
          s.device,
          0,
          iso(s.updatedAt),
          Math.round((s.updatedAt - s.startedAt) / 100) / 10,
          ...(withRaw ? [s.fpsAvg, s.fpsMin, s.latencyAvg, s.jankTotal, s.peakSpeed] : []),
          ...(withTrend ? [s.fpsAvg, s.latencyAvg, methodLabel, window] : []),
        ]
          .map(cell)
          .join(","),
      );
      return;
    }
    const fpsTrend = smoothSeries(
      samples.map((p) => p.fps ?? 0),
      window,
      method,
    );
    const latTrend = smoothSeries(
      samples.map((p) => p.latencyMs ?? 0),
      window,
      method,
    );
    samples.forEach((p, i) => {
      rows.push(
        [
          s.id,
          iso(s.startedAt),
          s.device,
          i + 1,
          iso(p.at),
          Math.round((p.at - s.startedAt) / 100) / 10,
          ...(withRaw ? [p.fps, p.fpsMin, p.latencyMs, p.jankFrames, p.peakSpeed] : []),
          ...(withTrend
            ? [fpsTrend[i] ?? p.fps, latTrend[i] ?? p.latencyMs, methodLabel, window]
            : []),
        ]
          .map(cell)
          .join(","),
      );
    });
  });
  return rows.join("\r\n");
}

/** Unduh CSV di browser (BOM agar Excel membaca UTF-8 dengan benar). */
export function downloadCsv(filename: string, content: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function scrollPerfCsvFilename(suffix?: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `scroll-perf-${suffix ? `${suffix}-` : ""}${stamp}.csv`;
}
