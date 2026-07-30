/**
 * Anchor bar bawah (bottom nav) ke *visual viewport*, bukan layout viewport.
 *
 * Masalah di mobile (Chrome Android / WebView Capacitor): elemen
 * `position: fixed; bottom: 0` diposisikan relatif ke layout viewport.
 * Saat address bar mengecil/membesar ketika scroll, layout viewport tidak
 * berubah tetapi visual viewport berubah — akibatnya bar bawah terlihat
 * "ikut naik-turun" / lag saat menggulir.
 *
 * Penting: perubahan visual viewport yang terjadi *saat menggulir* (address
 * bar Android menyusut / muncul kembali) TIDAK boleh dikompensasi, karena
 * translate yang menyusul satu frame di belakang justru membuat bar terlihat
 * "naik-turun"/bergetar. Jadi hook hanya melaporkan offset ketika perubahan
 * cukup besar untuk berarti keyboard virtual terbuka; selain itu offset = 0
 * dan bar cukup mengandalkan `position: fixed; bottom: 0`.
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
      const delta = Math.max(0, Math.round(raw));
      const keyboardOpen = delta > KEYBOARD_THRESHOLD;
      // Hanya kompensasi saat keyboard terbuka. Selisih kecil (address bar
      // auto-hide saat scroll) sengaja diabaikan agar bar diam total.
      const offset = keyboardOpen ? delta : 0;
      setState((prev) => {
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
    window.addEventListener("orientationchange", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, []);

  return state;
}