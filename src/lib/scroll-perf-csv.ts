/**
 * Ekspor time-series performa scroll (FPS & latensi) ke CSV.
 *
 * Satu baris = satu fase gulir yang terukur pada sebuah sesi, sehingga bisa
 * dianalisis di spreadsheet atau alat lain di luar aplikasi.
 */
import type { ScrollPerfSession } from "./scroll-perf-sessions";

const HEADERS = [
  "session_id",
  "session_started_at",
  "device",
  "sample_index",
  "sample_at",
  "seconds_since_session_start",
  "fps",
  "fps_min",
  "latency_ms",
  "jank_frames",
  "peak_speed_px_s",
];

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
export function buildScrollPerfCsv(sessions: ScrollPerfSession[]): string {
  const rows: string[] = [HEADERS.join(",")];
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
          s.fpsAvg,
          s.fpsMin,
          s.latencyAvg,
          s.jankTotal,
          s.peakSpeed,
        ]
          .map(cell)
          .join(","),
      );
      return;
    }
    samples.forEach((p, i) => {
      rows.push(
        [
          s.id,
          iso(s.startedAt),
          s.device,
          i + 1,
          iso(p.at),
          Math.round((p.at - s.startedAt) / 100) / 10,
          p.fps,
          p.fpsMin,
          p.latencyMs,
          p.jankFrames,
          p.peakSpeed,
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
