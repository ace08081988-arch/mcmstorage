/**
 * Anchor bar bawah (bottom nav) ke *visual viewport*, bukan layout viewport.
 *
 * Masalah di mobile (Chrome Android / WebView Capacitor): elemen
 * `position: fixed; bottom: 0` diposisikan relatif ke layout viewport.
 * Saat address bar mengecil/membesar ketika scroll, layout viewport tidak
 * berubah tetapi visual viewport berubah — akibatnya bar bawah terlihat
 * "ikut naik-turun" / lag saat menggulir.
 *
 * Kompensasi WAJIB dilakukan setiap saat: ketika address bar Android tampil,
 * layout viewport lebih tinggi daripada visual viewport, sehingga bar yang
 * `fixed; bottom: 0` terdorong ke bawah layar dan HILANG dari pandangan saat
 * menggulir. Supaya tidak terlihat "lag"/naik-turun, pengukuran dijalankan
 * dalam loop rAF selama viewport masih bergerak (scroll / resize), bukan
 * hanya sekali per event, dan transform di-render tanpa transition.
 */
import { useEffect, useState } from "react";

export type ViewportAnchor = {
  /** Jarak (px) yang harus dinaikkan agar bar menempel di dasar layar. */
  offset: number;
  /** True saat keyboard virtual kemungkinan terbuka. */
  keyboardOpen: boolean;
};

const KEYBOARD_THRESHOLD = 140;
/** Berapa lama loop rAF tetap hidup setelah viewport berhenti bergerak. */
const SETTLE_MS = 350;

export function useViewportAnchor(): ViewportAnchor {
  const [state, setState] = useState<ViewportAnchor>({ offset: 0, keyboardOpen: false });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let frame = 0;
    let stopAt = 0;

    const measure = () => {
      const layoutH = document.documentElement.clientHeight;
      // Dasar visual viewport relatif terhadap layout viewport.
      const raw = layoutH - (vv.height + vv.offsetTop);
      const delta = Math.max(0, Math.round(raw));
      const keyboardOpen = delta > KEYBOARD_THRESHOLD;
      setState((prev) => {
        if (prev.offset === delta && prev.keyboardOpen === keyboardOpen) return prev;
        return { offset: delta, keyboardOpen };
      });
    };

    const tick = () => {
      measure();
      if (performance.now() < stopAt) {
        frame = requestAnimationFrame(tick);
      } else {
        frame = 0;
      }
    };

    const schedule = () => {
      // Jaga loop tetap hidup selama viewport masih bergerak supaya posisi
      // bar mengikuti address bar per-frame (bukan tertinggal satu event).
      stopAt = performance.now() + SETTLE_MS;
      if (frame) return;
      frame = requestAnimationFrame(tick);
    };

    measure();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("orientationchange", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, []);

  return state;
}