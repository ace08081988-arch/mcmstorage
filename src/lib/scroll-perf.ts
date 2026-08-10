/**
 * Optimasi respons scroll (loop rAF tunggal).
 *
 * Saat halaman digulir, efek berat (kilau 3D, backdrop-blur, bayangan
 * besar, transisi hover) dimatikan sementara lewat atribut
 * `data-scrolling="1"` di <html>, lalu dipulihkan setelah gulir berhenti.
 *
 * Arsitektur:
 * - Listener event (scroll/wheel/touch) **tidak melakukan pekerjaan apa pun**
 *   selain menaikkan flag dan membangunkan loop. Ini penting untuk swipe
 *   cepat di Android WebView, di mana event scroll bisa datang puluhan kali
 *   per frame; melakukan kerja di tiap event menyebabkan stutter.
 * - Satu `requestAnimationFrame` berjalan selama gulir aktif. Loop inilah
 *   satu-satunya tempat `scrollY` dibaca, kecepatan dihitung, dan atribut
 *   DOM ditulis — maksimal sekali per frame, sinkron dengan compositor.
 * - Tidak ada `setTimeout`: ambang diam dihitung dari waktu frame, sehingga
 *   pemulihan selalu jatuh tepat di batas frame (bebas jitter timer).
 *
 * Pemulihan bersifat adaptif: gulir pelan pulih hampir seketika (~60ms),
 * sedangkan flick cepat yang masih punya inersia menunggu hingga ~220ms
 * agar efek berat tidak menyala di tengah momentum.
 */

import { setScrollEcoActive } from "@/lib/depth-quality";

/** Batas bawah/atas jeda pemulihan (ms). */
const IDLE_MIN_MS = 60;
const IDLE_MAX_MS = 220;
/** Kecepatan (px/ms) yang dianggap "cepat" — di atas ini pakai IDLE_MAX_MS. */
const FAST_VELOCITY = 2.5;
/** Di bawah ini dianggap praktis diam (inersia habis). */
const STILL_VELOCITY = 0.02;

/* ── Metrik performa (dibaca halaman diagnostik) ──────────────────── */

export type ScrollPerfMetrics = {
  /** FPS rata-rata selama fase gulir terakhir. */
  fps: number;
  /** FPS terendah (frame terlama) pada fase gulir terakhir. */
  fpsMin: number;
  /** Latensi input→frame pertama saat gulir dimulai (ms). */
  latencyMs: number;
  /** Latensi terburuk yang pernah tercatat pada sesi ini (ms). */
  latencyWorstMs: number;
  /** Jumlah frame yang melewati 16.7ms x2 (jank) pada fase terakhir. */
  jankFrames: number;
  /** Kecepatan puncak fase terakhir (px/detik). */
  peakSpeed: number;
  /** Berapa kali fase gulir sudah diukur. */
  samples: number;
  /** Sedang menggulir? */
  scrolling: boolean;
};

const emptyMetrics: ScrollPerfMetrics = {
  fps: 0,
  fpsMin: 0,
  latencyMs: 0,
  latencyWorstMs: 0,
  jankFrames: 0,
  peakSpeed: 0,
  samples: 0,
  scrolling: false,
};

let metrics: ScrollPerfMetrics = { ...emptyMetrics };
const listeners = new Set<() => void>();

function emit() {
  metrics = { ...metrics };
  listeners.forEach((l) => l());
}

export function subscribeScrollPerf(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getScrollPerfMetrics(): ScrollPerfMetrics {
  return metrics;
}

export function resetScrollPerfMetrics() {
  metrics = { ...emptyMetrics };
  emit();
}

/* ── Penanda kejadian (dipakai grafik diagnostik) ─────────────────── */

/**
 * Kejadian input yang bisa ditandai di grafik:
 * - `touch`: jari menyentuh layar (sebelum bergerak)
 * - `start`: fase gulir dimulai (frame pertama setelah input)
 * - `move` : gulir benar-benar bergerak cepat (geser/flick)
 * - `stop` : gulir berhenti dan efek berat dipulihkan
 */
export type ScrollPerfEventKind = "touch" | "start" | "move" | "stop";

export type ScrollPerfEvent = { kind: ScrollPerfEventKind; at: number };

const eventListeners = new Set<(e: ScrollPerfEvent) => void>();

export function subscribeScrollPerfEvents(
  cb: (e: ScrollPerfEvent) => void,
): () => void {
  eventListeners.add(cb);
  return () => eventListeners.delete(cb);
}

function emitEvent(kind: ScrollPerfEventKind) {
  if (!eventListeners.size) return;
  const e: ScrollPerfEvent = { kind, at: Date.now() };
  eventListeners.forEach((l) => l(e));
}

export function startScrollPerf(): () => void {
  if (typeof window === "undefined") return () => {};

  const root = document.documentElement;

  let active = false; // fase gulir sedang berlangsung
  let raf = 0;
  let touching = false;

  let lastY = 0;
  let lastT = 0;
  let velocity = 0; // px/ms, dihaluskan (EMA)
  let stillSince = 0; // timestamp frame pertama saat dianggap diam

  // Instrumentasi metrik fase gulir.
  let wakeAt = 0; // waktu event input pertama yang membangunkan loop
  let phaseStart = 0;
  let frames = 0;
  let worstFrame = 0;
  let jank = 0;
  let peakV = 0;
  /** Sudah menandai "geser" pada fase ini? */
  let movedMarked = false;

  const begin = (t: number) => {
    active = true;
    lastY = window.scrollY;
    lastT = t;
    velocity = 0;
    stillSince = 0;
    root.setAttribute("data-scrolling", "1");
    setScrollEcoActive(true);

    phaseStart = t;
    frames = 0;
    worstFrame = 0;
    jank = 0;
    peakV = 0;
    metrics.latencyMs = wakeAt ? Math.max(0, Math.round((t - wakeAt) * 10) / 10) : 0;
    metrics.latencyWorstMs = Math.max(metrics.latencyWorstMs, metrics.latencyMs);
    metrics.scrolling = true;
    emit();
    movedMarked = false;
    emitEvent("start");
  };

  const end = () => {
    active = false;
    velocity = 0;
    stillSince = 0;
    root.removeAttribute("data-scrolling");
    setScrollEcoActive(false);

    const dur = lastT - phaseStart;
    if (dur > 80 && frames > 3) {
      metrics.fps = Math.round((frames / dur) * 1000);
      metrics.fpsMin = worstFrame > 0 ? Math.round(1000 / worstFrame) : 0;
      metrics.jankFrames = jank;
      metrics.peakSpeed = Math.round(peakV * 1000);
      metrics.samples += 1;
      // Akumulasi ke ringkasan sesi (riwayat di halaman Diagnostik).
      void import("./scroll-perf-sessions")
        .then(({ recordScrollPerfPhase }) => recordScrollPerfPhase(metrics))
        .catch(() => {});
    }
    metrics.scrolling = false;
    emit();
    emitEvent("stop");
  };

  /** Ambang diam berdasar kecepatan terakhir. */
  const idleDelay = () => {
    const ratio = Math.min(1, velocity / FAST_VELOCITY);
    return IDLE_MIN_MS + (IDLE_MAX_MS - IDLE_MIN_MS) * ratio;
  };

  const frame = (t: number) => {
    raf = 0;

    if (!active) {
      begin(t);
      raf = requestAnimationFrame(frame);
      return;
    }

    const dt = t - lastT;
    if (dt > 0) {
      const y = window.scrollY;
      const v = Math.abs(y - lastY) / dt;
      // EMA: responsif terhadap perubahan, tapi tidak gugup pada satu frame anomali.
      velocity = velocity * 0.6 + v * 0.4;
      if (velocity > peakV) peakV = velocity;
      if (!movedMarked && velocity > 0.3) {
        movedMarked = true;
        emitEvent("move");
      }
      frames += 1;
      if (dt > worstFrame) worstFrame = dt;
      if (dt > 33.4) jank += 1;
      lastY = y;
      lastT = t;
    }

    const moving = velocity > STILL_VELOCITY || touching;
    if (moving) {
      stillSince = 0;
    } else {
      if (!stillSince) stillSince = t;
      // Jari sudah lepas dan inersia habis → pulihkan efek.
      if (t - stillSince >= idleDelay()) {
        end();
        return;
      }
    }

    raf = requestAnimationFrame(frame);
  };

  /** Listener super-ringan: hanya membangunkan loop. */
  const wake = () => {
    if (!raf) {
      wakeAt = performance.now();
      raf = requestAnimationFrame(frame);
    }
    if (active) stillSince = 0;
  };

  const onTouchStart = () => {
    touching = true;
    emitEvent("touch");
    wake();
  };
  const onTouchEnd = () => {
    touching = false;
    wake();
  };

  window.addEventListener("scroll", wake, { passive: true, capture: true });
  window.addEventListener("wheel", wake, { passive: true });
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", wake, { passive: true });
  window.addEventListener("touchend", onTouchEnd, { passive: true });
  window.addEventListener("touchcancel", onTouchEnd, { passive: true });

  return () => {
    window.removeEventListener("scroll", wake, { capture: true } as EventListenerOptions);
    window.removeEventListener("wheel", wake);
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchmove", wake);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", onTouchEnd);
    if (raf) cancelAnimationFrame(raf);
    end();
  };
}
