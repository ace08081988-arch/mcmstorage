/**
 * Riwayat metrik performa scroll per sesi.
 *
 * Satu "sesi" = satu kali aplikasi dibuka (satu page load). Setiap fase gulir
 * yang terukur diakumulasi ke ringkasan sesi berjalan, lalu disimpan di
 * localStorage supaya bisa dibandingkan dengan sesi-sesi sebelumnya di
 * halaman Diagnostik viewport.
 */
import type { ScrollPerfMetrics } from "./scroll-perf";

/** Satu titik time-series: hasil satu fase gulir yang selesai. */
export type ScrollPerfSample = {
  /** Waktu fase selesai (epoch ms). */
  at: number;
  fps: number;
  fpsMin: number;
  latencyMs: number;
  jankFrames: number;
  peakSpeed: number;
};

export type ScrollPerfSession = {
  id: string;
  /** Waktu sesi dimulai (epoch ms). */
  startedAt: number;
  /** Terakhir kali sesi ini diperbarui (epoch ms). */
  updatedAt: number;
  /** Jumlah fase gulir yang terukur pada sesi ini. */
  phases: number;
  /** Rata-rata FPS seluruh fase. */
  fpsAvg: number;
  /** FPS terendah yang pernah tercatat. */
  fpsMin: number;
  /** Rata-rata latensi sentuh→frame (ms). */
  latencyAvg: number;
  /** Latensi terburuk (ms). */
  latencyWorst: number;
  /** Total frame tersendat. */
  jankTotal: number;
  /** Kecepatan usap tertinggi (px/dtk). */
  peakSpeed: number;
  /** Label perangkat/layar singkat untuk membedakan sesi. */
  device: string;
  /** Time-series FPS & latensi per fase gulir (untuk ekspor CSV). */
  samples?: ScrollPerfSample[];
};

export const SCROLL_PERF_SESSIONS_KEY = "app-scroll-perf-sessions";
/** Simpan sekian sesi terakhir saja supaya localStorage tetap ramping. */
const MAX_SESSIONS = 20;
/** Batas titik time-series per sesi supaya localStorage tetap ramping. */
const MAX_SAMPLES = 300;

const listeners = new Set<() => void>();
let cache: ScrollPerfSession[] | null = null;
let currentId: string | null = null;
let sumFps = 0;
let sumLatency = 0;

function emit() {
  cache = null;
  listeners.forEach((l) => l());
}

function readRaw(): ScrollPerfSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SCROLL_PERF_SESSIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as ScrollPerfSession[]) : [];
  } catch {
    return [];
  }
}

function write(rows: ScrollPerfSession[]) {
  try {
    localStorage.setItem(
      SCROLL_PERF_SESSIONS_KEY,
      JSON.stringify(rows.slice(0, MAX_SESSIONS)),
    );
  } catch {
    /* kuota penuh / mode privat → riwayat dilewati saja */
  }
}

/** Daftar sesi, terbaru di atas. */
export function listScrollPerfSessions(): ScrollPerfSession[] {
  if (!cache) cache = readRaw();
  return cache;
}

export function subscribeScrollPerfSessions(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function clearScrollPerfSessions(): void {
  currentId = null;
  sumFps = 0;
  sumLatency = 0;
  write([]);
  emit();
}

function deviceLabel(): string {
  if (typeof window === "undefined") return "—";
  const w = Math.round(window.innerWidth);
  const h = Math.round(window.innerHeight);
  const dpr = Math.round((window.devicePixelRatio || 1) * 10) / 10;
  return `${w}×${h} @${dpr}x`;
}

/**
 * Catat satu fase gulir yang selesai ke ringkasan sesi berjalan.
 * Dipanggil dari loop `scroll-perf` setiap fase berakhir.
 */
export function recordScrollPerfPhase(m: ScrollPerfMetrics): void {
  if (typeof window === "undefined") return;
  if (!m.fps) return;

  const rows = readRaw();
  const now = Date.now();

  let session = currentId ? rows.find((r) => r.id === currentId) : undefined;
  if (!session) {
    currentId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    sumFps = 0;
    sumLatency = 0;
    session = {
      id: currentId,
      startedAt: now,
      updatedAt: now,
      phases: 0,
      fpsAvg: 0,
      fpsMin: 0,
      latencyAvg: 0,
      latencyWorst: 0,
      jankTotal: 0,
      peakSpeed: 0,
      device: deviceLabel(),
      samples: [],
    };
    rows.unshift(session);
  }

  session.phases += 1;
  sumFps += m.fps;
  sumLatency += m.latencyMs;
  session.fpsAvg = Math.round(sumFps / session.phases);
  session.fpsMin = session.fpsMin ? Math.min(session.fpsMin, m.fpsMin || session.fpsMin) : m.fpsMin;
  session.latencyAvg = Math.round((sumLatency / session.phases) * 10) / 10;
  session.latencyWorst = Math.max(session.latencyWorst, m.latencyWorstMs);
  session.jankTotal += m.jankFrames;
  session.peakSpeed = Math.max(session.peakSpeed, m.peakSpeed);
  session.updatedAt = now;
  const samples = session.samples ?? (session.samples = []);
  samples.push({
    at: now,
    fps: m.fps,
    fpsMin: m.fpsMin,
    latencyMs: m.latencyMs,
    jankFrames: m.jankFrames,
    peakSpeed: m.peakSpeed,
  });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);

  write(rows);
  emit();
}
