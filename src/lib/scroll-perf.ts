/**
 * Optimasi respons scroll.
 *
 * Saat halaman digulir, efek berat (kilau 3D, backdrop-blur, bayangan
 * besar, transisi hover) dimatikan sementara lewat atribut
 * `data-scrolling="1"` di <html>. Begitu gulir berhenti (~140ms) efeknya
 * kembali. Ini menghilangkan jank/lag terutama di Android WebView.
 *
 * Semua listener pasif dan hanya menyentuh satu atribut DOM per fase —
 * tidak ada pembacaan layout di dalam handler.
 */

import { setScrollEcoActive } from "@/lib/depth-quality";

const IDLE_MS = 140;

export function startScrollPerf(): () => void {
  if (typeof window === "undefined") return () => {};

  const root = document.documentElement;
  let scrolling = false;
  let idleTimer = 0;
  let raf = 0;

  const stop = () => {
    scrolling = false;
    root.removeAttribute("data-scrolling");
    setScrollEcoActive(false);
  };

  const markIdle = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(stop, IDLE_MS);
  };

  const onScroll = () => {
    if (!scrolling) {
      scrolling = true;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (scrolling) {
            root.setAttribute("data-scrolling", "1");
            setScrollEcoActive(true);
          }
        });
      }
    }
    markIdle();
  };

  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("wheel", onScroll, { passive: true });
  window.addEventListener("touchmove", onScroll, { passive: true });

  return () => {
    window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
    window.removeEventListener("wheel", onScroll);
    window.removeEventListener("touchmove", onScroll);
    window.clearTimeout(idleTimer);
    if (raf) cancelAnimationFrame(raf);
    stop();
  };
}
