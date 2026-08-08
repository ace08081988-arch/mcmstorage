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

  const begin = (t: number) => {
    active = true;
    lastY = window.scrollY;
    lastT = t;
    velocity = 0;
    stillSince = 0;
    root.setAttribute("data-scrolling", "1");
    setScrollEcoActive(true);
  };

  const end = () => {
    active = false;
    velocity = 0;
    stillSince = 0;
    root.removeAttribute("data-scrolling");
    setScrollEcoActive(false);
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
    if (!raf) raf = requestAnimationFrame(frame);
    if (active) stillSince = 0;
  };

  const onTouchStart = () => {
    touching = true;
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
