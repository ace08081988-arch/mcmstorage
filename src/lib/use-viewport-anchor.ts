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
import {
  getViewportAnchorConfig,
  VIEWPORT_ANCHOR_CONFIG_EVENT,
} from "@/lib/viewport-anchor-config";

export type ViewportAnchor = {
  /**
   * Nama CSS variable yang berisi jarak (px) yang harus dinaikkan agar bar
   * menempel di dasar layar. Nilainya ditulis langsung ke `documentElement`
   * per-frame sehingga TIDAK memicu re-render React — posisi bar jadi imun
   * terhadap re-render VirtualizedList / perubahan tinggi baris.
   */
  offsetVar: string;
  /** Style siap pakai untuk elemen bar (transform berbasis CSS variable). */
  anchorStyle: { transform: string; willChange: "transform" };
  /** True saat keyboard virtual kemungkinan terbuka. */
  keyboardOpen: boolean;
};

export type ViewportAnchorOptions = {
  /**
   * Mode pengunci posisi. Bar hanya mengikuti pergerakan address bar
   * (chrome browser) dan MENGABAIKAN perubahan viewport akibat keyboard —
   * posisi terakhir sebelum keyboard muncul dipertahankan, jadi bar tidak
   * pernah melompat saat keyboard buka/tutup.
   */
  lock?: boolean;
};

/**
 * Semua ambang bersifat dapat disetel per perangkat (lihat
 * `src/lib/viewport-anchor-config.ts`) supaya perangkat low-end dengan rAF
 * lambat / pengukuran berisik bisa dilonggarkan tanpa mengubah kode.
 */

export const VIEWPORT_ANCHOR_VAR = "--vv-anchor-offset";
/** Offset "terkunci": hanya address bar, tidak terpengaruh keyboard. */
export const VIEWPORT_ANCHOR_LOCK_VAR = "--vv-anchor-offset-lock";
const ANCHOR_TRANSFORM = `translate3d(0, calc(var(${VIEWPORT_ANCHOR_VAR}, 0px) * -1), 0)`;
const ANCHOR_TRANSFORM_LOCKED = `translate3d(0, calc(var(${VIEWPORT_ANCHOR_LOCK_VAR}, 0px) * -1), 0)`;

/**
 * Satu subscriber global: semua bar memakai pengukuran yang sama sehingga
 * tidak pernah ada dua loop rAF yang saling mendahului (sumber pergeseran
 * saat beberapa list ikut re-render bersamaan).
 */
type Listener = (keyboardOpen: boolean) => void;
const listeners = new Set<Listener>();
let started = false;
let currentOffset = 0;
let currentLockOffset = 0;
let currentKeyboardOpen = false;
let stopEngine: (() => void) | null = null;
/** Tinggi visual viewport terbesar yang pernah terlihat (viewport "penuh"). */
let baselineHeight = 0;
let lastScrollAt = 0;

function startEngine() {
  const vv = window.visualViewport;
  if (!vv) return;

  let frame = 0;
  let stopAt = 0;

  const measure = () => {
    const cfg = getViewportAnchorConfig();
    const layoutH = document.documentElement.clientHeight;
    const raw = layoutH - (vv.height + vv.offsetTop);
    const next = Math.max(0, Math.round(raw));

    // --- Klasifikasi sumber shrink: address bar vs keyboard ---------------
    // Baseline = tinggi visual viewport saat tidak ada apa pun yang menutup.
    if (vv.height > baselineHeight) baselineHeight = vv.height;
    const shrink = Math.max(0, Math.round(baselineHeight - vv.height));
    const recentlyScrolled = performance.now() - lastScrollAt < cfg.scrollGraceMs;

    let keyboardOpen = currentKeyboardOpen;
    if (currentKeyboardOpen) {
      // Tetap "terbuka" sampai shrink benar-benar mengecil (hysteresis),
      // supaya animasi keyboard tidak bikin status berkedip.
      if (shrink < cfg.keyboardClosePx) keyboardOpen = false;
    } else {
      const looksLikeChrome = shrink <= cfg.maxChromePx && recentlyScrolled;
      keyboardOpen = shrink > cfg.keyboardOpenPx && !looksLikeChrome;
    }

    // Kompensasi HANYA saat keyboard terbuka. Shrink akibat address bar
    // dibiarkan (bar tetap menempel di dasar layar oleh `bottom: 0`), jadi
    // tidak ada transform yang bergerak-gerak saat menggulir.
    const target = cfg.enabled && keyboardOpen ? next : 0;

    // Hysteresis: perubahan <= 1px diabaikan (reflow dari list virtual sering
    // menghasilkan beda pecahan pixel yang bikin bar terlihat bergeser).
    if (
      Math.abs(target - currentOffset) > cfg.hysteresisPx ||
      keyboardOpen !== currentKeyboardOpen
    ) {
      currentOffset = target;
      document.documentElement.style.setProperty(VIEWPORT_ANCHOR_VAR, `${target}px`);
    }

    // Mode terkunci: hanya diperbarui ketika keyboard tertutup, sehingga
    // posisinya benar-benar diam apa pun yang terjadi pada address bar.
    if (!keyboardOpen && Math.abs(currentLockOffset) > cfg.hysteresisPx) {
      currentLockOffset = 0;
      document.documentElement.style.setProperty(VIEWPORT_ANCHOR_LOCK_VAR, "0px");
    }

    if (keyboardOpen !== currentKeyboardOpen) {
      currentKeyboardOpen = keyboardOpen;
      listeners.forEach((fn) => fn(keyboardOpen));
    }
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
    stopAt = performance.now() + getViewportAnchorConfig().settleMs;
    if (frame) return;
    frame = requestAnimationFrame(tick);
  };

  const onScroll = () => {
    lastScrollAt = performance.now();
    schedule();
  };

  measure();
  document.documentElement.style.setProperty(VIEWPORT_ANCHOR_VAR, `${currentOffset}px`);
  document.documentElement.style.setProperty(VIEWPORT_ANCHOR_LOCK_VAR, `${currentLockOffset}px`);

  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", onScroll);
  window.addEventListener("scroll", onScroll, { passive: true });
  const onOrientation = () => {
    // Rotasi mengubah tinggi layar → baseline lama tidak valid lagi.
    baselineHeight = 0;
    schedule();
  };
  window.addEventListener("orientationchange", onOrientation);
  // Perubahan pengaturan sensitivitas berlaku langsung, tanpa reload.
  const onConfig = () => schedule();
  window.addEventListener(VIEWPORT_ANCHOR_CONFIG_EVENT, onConfig);

  // Perubahan tinggi dokumen (VirtualizedList menambah/mengurangi spacer,
  // tinggi baris terukur ulang) bisa menggeser layout viewport tanpa event
  // viewport apa pun. Ukur ulang sekali per perubahan, bukan per render.
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => schedule());
    ro.observe(document.documentElement);
  }

  stopEngine = () => {
    if (frame) cancelAnimationFrame(frame);
    ro?.disconnect();
    vv.removeEventListener("resize", schedule);
    vv.removeEventListener("scroll", onScroll);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("orientationchange", onOrientation);
    window.removeEventListener(VIEWPORT_ANCHOR_CONFIG_EVENT, onConfig);
    document.documentElement.style.removeProperty(VIEWPORT_ANCHOR_VAR);
    document.documentElement.style.removeProperty(VIEWPORT_ANCHOR_LOCK_VAR);
  };
}

export function useViewportAnchor(options: ViewportAnchorOptions = {}): ViewportAnchor {
  const lock = options.lock ?? false;
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const listener: Listener = (open) => setKeyboardOpen(open);
    listeners.add(listener);
    if (!started) {
      started = true;
      startEngine();
    }
    setKeyboardOpen(currentKeyboardOpen);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopEngine?.();
        stopEngine = null;
        started = false;
        currentOffset = 0;
        currentLockOffset = 0;
        currentKeyboardOpen = false;
        baselineHeight = 0;
        lastScrollAt = 0;
      }
    };
  }, []);

  return {
    offsetVar: lock ? VIEWPORT_ANCHOR_LOCK_VAR : VIEWPORT_ANCHOR_VAR,
    anchorStyle: {
      transform: lock ? ANCHOR_TRANSFORM_LOCKED : ANCHOR_TRANSFORM,
      willChange: "transform",
    },
    keyboardOpen,
  };
}