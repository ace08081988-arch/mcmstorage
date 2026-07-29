/**
 * Anchor bar bawah (bottom nav) ke *visual viewport*, bukan layout viewport.
 *
 * Masalah di mobile (Chrome Android / WebView Capacitor): elemen
 * `position: fixed; bottom: 0` diposisikan relatif ke layout viewport.
 * Saat address bar mengecil/membesar ketika scroll, layout viewport tidak
 * berubah tetapi visual viewport berubah — akibatnya bar bawah terlihat
 * "ikut naik-turun" / lag saat menggulir.
 *
 * Hook ini menghitung selisih antara dasar layout viewport dan dasar
 * visual viewport, lalu mengembalikan offset (px) untuk dipakai sebagai
 * `translateY(-offset)` sehingga bar selalu menempel di tepi bawah layar.
 * Juga mendeteksi keyboard terbuka supaya bar bisa disembunyikan.
 */
import { useEffect, useState } from "react";

export type ViewportAnchor = {
  /** Jarak (px) yang harus dinaikkan agar bar menempel di dasar layar. */
  offset: number;
  /** True saat keyboard virtual kemungkinan terbuka. */
  keyboardOpen: boolean;
};

const KEYBOARD_THRESHOLD = 140;

export function useViewportAnchor(): ViewportAnchor {
  const [state, setState] = useState<ViewportAnchor>({ offset: 0, keyboardOpen: false });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const layoutH = document.documentElement.clientHeight;
      // Dasar visual viewport relatif terhadap layout viewport.
      const raw = layoutH - (vv.height + vv.offsetTop);
      const offset = Math.max(0, Math.round(raw));
      setState((prev) => {
        const keyboardOpen = offset > KEYBOARD_THRESHOLD;
        if (prev.offset === offset && prev.keyboardOpen === keyboardOpen) return prev;
        return { offset, keyboardOpen };
      });
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, []);

  return state;
}