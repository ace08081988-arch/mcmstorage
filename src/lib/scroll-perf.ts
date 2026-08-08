/**
 * Optimasi respons scroll.
 *
 * Saat halaman digulir, efek berat (kilau 3D, backdrop-blur, bayangan
 * besar, transisi hover) dimatikan sementara lewat atribut
 * `data-scrolling="1"` di <html>. Begitu gulir berhenti, efeknya kembali.
 *
 * Jeda pemulihan bersifat **adaptif**: gulir pelan (mis. membaca sambil
 * menggeser sedikit) pulih hampir seketika (~60ms), sedangkan gulir/flick
 * cepat yang masih punya momentum menunggu sedikit lebih lama (~220ms)
 * agar efek berat tidak menyala di tengah inersia.
 *
 * Semua listener pasif dan hanya menyentuh satu atribut DOM per fase.
 */

import { setScrollEcoActive } from "@/lib/depth-quality";

/** Batas bawah/atas jeda pemulihan (ms). */
const IDLE_MIN_MS = 60;
const IDLE_MAX_MS = 220;
/** Kecepatan (px/ms) yang dianggap "cepat" — di atas ini pakai IDLE_MAX_MS. */
const FAST_VELOCITY = 2.5;

export function startScrollPerf(): () => void {
  if (typeof window === "undefined") return () => {};

  const root = document.documentElement;
  let scrolling = false;
  let idleTimer = 0;
  let raf = 0;

  // Pelacakan kecepatan (EMA) untuk debounce adaptif.
  let lastY = window.scrollY;
  let lastT = performance.now();
  let velocity = 0; // px/ms

  const stop = () => {
    scrolling = false;
    velocity = 0;
    root.removeAttribute("data-scrolling");
    setScrollEcoActive(false);
  };

  /** Jeda pemulihan berdasar kecepatan terakhir. */
  const idleDelay = () => {
    const ratio = Math.min(1, velocity / FAST_VELOCITY);
    return Math.round(IDLE_MIN_MS + (IDLE_MAX_MS - IDLE_MIN_MS) * ratio);
  };

  const markIdle = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(stop, idleDelay());
  };

  const sampleVelocity = () => {
    const now = performance.now();
    const dt = now - lastT;
    if (dt >= 16) {
      const y = window.scrollY;
      const v = Math.abs(y - lastY) / dt;
      // EMA: responsif tapi tidak gugup terhadap satu frame anomali.
      velocity = velocity * 0.6 + v * 0.4;
      lastY = y;
      lastT = now;
    }
  };

  const onScroll = () => {
    if (!scrolling) {
      scrolling = true;
      lastY = window.scrollY;
      lastT = performance.now();
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (scrolling) {
            root.setAttribute("data-scrolling", "1");
            setScrollEcoActive(true);
          }
        });
      }
    } else {
      sampleVelocity();
    }
    markIdle();
  };

  // Jari diangkat tanpa momentum berarti → pulihkan efek segera.
  const onTouchEnd = () => {
    if (scrolling && velocity < 0.15) {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(stop, IDLE_MIN_MS);
    }
  };

  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("wheel", onScroll, { passive: true });
  window.addEventListener("touchmove", onScroll, { passive: true });
  window.addEventListener("touchend", onTouchEnd, { passive: true });
  window.addEventListener("touchcancel", onTouchEnd, { passive: true });

  return () => {
    window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
    window.removeEventListener("wheel", onScroll);
    window.removeEventListener("touchmove", onScroll);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", onTouchEnd);
    window.clearTimeout(idleTimer);
    if (raf) cancelAnimationFrame(raf);
    stop();
  };
}
