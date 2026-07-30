/**
 * Metrik ringan untuk daftar virtual (`VirtualizedList`).
 *
 * Tujuan: memantau di PRODUKSI (di HP, tanpa DevTools) apakah sebuah
 * daftar jadi berat — berapa lama commit render-nya dan seberapa sering
 * ia re-render — per route dan per daftar.
 *
 * Desain sengaja murah:
 *  - Semua agregasi in-memory (counter + rata-rata berjalan), tidak ada
 *    array sampel yang tumbuh.
 *  - Tidak ada network per render; flush opsional ke beacon perf-log
 *    hanya saat halaman disembunyikan.
 *  - Aman di SSR (semua API dijaga `typeof window`).
 */
import { perfEvent } from "@/lib/perf-log";

export type ListPerfStat = {
  /** `route::cacheKey` */
  id: string;
  route: string;
  list: string;
  /** jumlah commit render (≈ re-render) sejak halaman dimuat */
  renders: number;
  /** jumlah mount komponen (deteksi remount berlebihan) */
  mounts: number;
  /** durasi commit terakhir (ms) */
  lastMs: number;
  /** rata-rata durasi commit (ms) */
  avgMs: number;
  /** commit terlama (ms) */
  maxMs: number;
  /** jumlah commit > 16ms (lewat satu frame 60fps) */
  slowFrames: number;
  /** jumlah item terakhir yang dirender */
  items: number;
  /** jumlah baris yang benar-benar dipasang di DOM terakhir kali */
  rendered: number;
  updatedAt: number;
};

const SLOW_FRAME_MS = 16;
const stats = new Map<string, ListPerfStat>();
const listeners = new Set<() => void>();
let notifyQueued = false;

function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  // Gabungkan notifikasi dalam satu task supaya panel pemantau tidak
  // ikut memicu render berantai saat daftar sedang sibuk.
  setTimeout(() => {
    notifyQueued = false;
    listeners.forEach((fn) => fn());
  }, 250);
}

export function subscribeListPerf(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getListPerfSnapshot(): ListPerfStat[] {
  return Array.from(stats.values()).sort((a, b) => b.avgMs - a.avgMs);
}

export function resetListPerf(): void {
  stats.clear();
  notify();
}

export function recordListMount(route: string, list: string): void {
  const s = ensure(route, list);
  s.mounts += 1;
  s.updatedAt = Date.now();
  notify();
}

export function recordListRender(
  route: string,
  list: string,
  ms: number,
  items: number,
  rendered: number,
): void {
  const s = ensure(route, list);
  s.renders += 1;
  s.lastMs = Math.round(ms * 100) / 100;
  s.avgMs = Math.round(((s.avgMs * (s.renders - 1) + ms) / s.renders) * 100) / 100;
  if (ms > s.maxMs) s.maxMs = Math.round(ms * 100) / 100;
  if (ms > SLOW_FRAME_MS) s.slowFrames += 1;
  s.items = items;
  s.rendered = rendered;
  s.updatedAt = Date.now();
  notify();
}

function ensure(route: string, list: string): ListPerfStat {
  const id = `${route}::${list}`;
  let s = stats.get(id);
  if (!s) {
    s = {
      id,
      route,
      list,
      renders: 0,
      mounts: 0,
      lastMs: 0,
      avgMs: 0,
      maxMs: 0,
      slowFrames: 0,
      items: 0,
      rendered: 0,
      updatedAt: Date.now(),
    };
    stats.set(id, s);
  }
  return s;
}

/** Kirim ringkasan sekali saat halaman ditinggalkan (beacon, best-effort). */
let flushArmed = false;
export function armListPerfFlush(): void {
  if (flushArmed || typeof document === "undefined") return;
  flushArmed = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    const snap = getListPerfSnapshot().filter((s) => s.renders > 0);
    if (snap.length === 0) return;
    perfEvent("virtualized-list", {
      lists: snap.map((s) => ({
        id: s.id,
        renders: s.renders,
        mounts: s.mounts,
        avgMs: s.avgMs,
        maxMs: s.maxMs,
        slowFrames: s.slowFrames,
        items: s.items,
      })),
    });
  });
}

if (typeof window !== "undefined") {
  // Akses cepat dari WebView Android tanpa DevTools:
  // `window.__mcmListPerf()` mengembalikan snapshot JSON.
  (window as unknown as Record<string, unknown>).__mcmListPerf =
    getListPerfSnapshot;
}