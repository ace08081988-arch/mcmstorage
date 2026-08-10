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
import { observeAnchorFrame } from "@/lib/viewport-anchor-autotune";
import { recordAnchorEvent } from "@/lib/viewport-anchor-log";
import { startSafeAreaRecalc } from "@/lib/safe-area-recalc";

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

/** Sumber penyusutan viewport yang sedang terdeteksi. */
export type ViewportAnchorMode = "idle" | "chrome" | "keyboard";

export type ViewportAnchorState = {
  /** idle = viewport penuh, chrome = address bar, keyboard = keyboard terbuka. */
  mode: ViewportAnchorMode;
  /** Penyusutan (px) relatif tinggi viewport terbesar yang pernah terlihat. */
  shrinkPx: number;
  /** Offset kompensasi (px) yang sedang diterapkan ke bar. */
  offsetPx: number;
  /** Tinggi viewport penuh (baseline) dan tinggi visual viewport saat ini. */
  baselinePx: number;
  viewportPx: number;
  /** True bila scroll baru saja terjadi (dalam jendela grace). */
  recentlyScrolled: boolean;
};

const INITIAL_STATE: ViewportAnchorState = {
  mode: "idle",
  shrinkPx: 0,
  offsetPx: 0,
  baselinePx: 0,
  viewportPx: 0,
  recentlyScrolled: false,
};

let currentState: ViewportAnchorState = INITIAL_STATE;
type StateListener = (s: ViewportAnchorState) => void;
const stateListeners = new Set<StateListener>();

function publishState(next: ViewportAnchorState) {
  const prev = currentState;
  // Hanya siarkan bila ada perubahan yang terlihat mata (hindari re-render tiap frame).
  if (
    prev.mode === next.mode &&
    Math.abs(prev.shrinkPx - next.shrinkPx) < 2 &&
    Math.abs(prev.offsetPx - next.offsetPx) < 2 &&
    prev.recentlyScrolled === next.recentlyScrolled
  ) {
    return;
  }
  currentState = next;
  stateListeners.forEach((fn) => fn(next));
  // Rekam hanya perubahan yang lolos filter di atas (bukan tiap frame).
  recordAnchorEvent({
    kind: prev.mode === next.mode ? "offset" : "mode",
    mode: next.mode,
    shrinkPx: next.shrinkPx,
    offsetPx: next.offsetPx,
    viewportPx: next.viewportPx,
    baselinePx: next.baselinePx,
    recentlyScrolled: next.recentlyScrolled,
    detail: prev.mode === next.mode ? undefined : `${prev.mode} → ${next.mode}`,
  });
}

let started = false;
let currentOffset = 0;
let currentLockOffset = 0;
/** Target offset "terkunci" sebelum dihaluskan (lihat smoothing di measure). */
let lockTarget = 0;
/** True selama offset terkunci masih bergerak menuju target. */
let lockSettling = false;
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

    // Kompensasi WAJIB selalu aktif. Di WebView Android, `position: fixed;
    // bottom: 0` menempel ke *layout viewport* yang lebih tinggi daripada
    // visual viewport saat address bar tampil — akibatnya bar terdorong ke
    // bawah layar dan HILANG saat menggulir (regresi yang terlihat di
    // rekaman layar). `next` = selisih layout vs visual viewport, jadi bar
    // selalu kembali menempel ke dasar layar yang benar-benar terlihat.
    const target = cfg.enabled ? next : 0;

    // Hysteresis: perubahan <= 1px diabaikan (reflow dari list virtual sering
    // menghasilkan beda pecahan pixel yang bikin bar terlihat bergeser).
    if (
      Math.abs(target - currentOffset) > cfg.hysteresisPx ||
      keyboardOpen !== currentKeyboardOpen
    ) {
      currentOffset = target;
      document.documentElement.style.setProperty(VIEWPORT_ANCHOR_VAR, `${target}px`);
    }

    // Mode terkunci: mengikuti address bar, TAPI dibekukan saat keyboard
    // terbuka supaya bar tidak melompat mengikuti animasi keyboard.
    //
    // Address bar Chrome/WebView Android mengembang-menciut dengan animasi
    // ~150–250ms, sementara `visualViewport.resize` hanya dikirim beberapa
    // kali (kadang sekali di akhir). Kalau offset dipasang mentah, bar
    // terlihat "loncat" satu langkah besar. Karena itu offset terkunci
    // dihaluskan: setiap frame bergerak sebagian menuju target sampai
    // selisihnya < 0.5px, lalu di-snap persis ke target.
    if (!keyboardOpen) lockTarget = target;
    const lockDiff = lockTarget - currentLockOffset;
    // Saat keyboard TERTUTUP (perubahan datang dari address bar / scroll),
    // offset di-snap persis ke target setiap frame. Penghalusan bertahap
    // membuat bar terlihat ikut menggeser sedikit saat menggulir; snapping
    // membuat bar terasa benar-benar diam di dasar layar.
    if (!keyboardOpen) {
      if (Math.abs(lockDiff) > 0.01) {
        currentLockOffset = lockTarget;
        lockSettling = false;
        document.documentElement.style.setProperty(
          VIEWPORT_ANCHOR_LOCK_VAR,
          `${lockTarget}px`,
        );
      }
    } else if (Math.abs(lockDiff) > 0.5) {
      // Faktor 0.3 ≈ waktu tempuh ~10 frame (±160ms) — sepadan dengan durasi
      // animasi address bar, jadi gerakannya terasa menyatu, bukan menyusul.
      currentLockOffset += lockDiff * 0.3;
      lockSettling = true;
      document.documentElement.style.setProperty(
        VIEWPORT_ANCHOR_LOCK_VAR,
        `${Math.round(currentLockOffset * 100) / 100}px`,
      );
    } else if (lockSettling || currentLockOffset !== lockTarget) {
      currentLockOffset = lockTarget;
      lockSettling = false;
      document.documentElement.style.setProperty(
        VIEWPORT_ANCHOR_LOCK_VAR,
        `${lockTarget}px`,
      );
    }

    if (keyboardOpen !== currentKeyboardOpen) {
      currentKeyboardOpen = keyboardOpen;
      listeners.forEach((fn) => fn(keyboardOpen));
    }

    publishState({
      mode: keyboardOpen
        ? "keyboard"
        : shrink > cfg.hysteresisPx
          ? "chrome"
          : "idle",
      shrinkPx: shrink,
      offsetPx: currentOffset,
      baselinePx: Math.round(baselineHeight),
      viewportPx: Math.round(vv.height),
      recentlyScrolled,
    });

    // Auto-tuning: belajar dari stabilitas posisi bar di perangkat ini.
    observeAnchorFrame({
      now: performance.now(),
      shrinkPx: shrink,
      offsetPx: currentOffset,
      keyboardOpen,
      recentlyScrolled,
      config: cfg,
    });
  };

  const tick = () => {
    measure();
    // Loop tetap hidup selama offset terkunci masih menuju target supaya
    // animasi penghalusan tidak terpotong di tengah jalan.
    if (performance.now() < stopAt || lockSettling) {
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
  const onConfig = () => {
    const c = getViewportAnchorConfig();
    recordAnchorEvent({
      kind: "autotune",
      mode: currentState.mode,
      shrinkPx: currentState.shrinkPx,
      offsetPx: currentState.offsetPx,
      viewportPx: currentState.viewportPx,
      baselinePx: currentState.baselinePx,
      recentlyScrolled: currentState.recentlyScrolled,
      detail: `config: buka>${c.keyboardOpenPx} tutup<${c.keyboardClosePx} grace ${c.scrollGraceMs} settle ${c.settleMs} hyst ${c.hysteresisPx}`,
    });
    schedule();
  };
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
    const stopSafeArea = startSafeAreaRecalc();
    if (!started) {
      started = true;
      startEngine();
    }
    setKeyboardOpen(currentKeyboardOpen);
    return () => {
      listeners.delete(listener);
      stopSafeArea();
      if (listeners.size === 0) {
        stopEngine?.();
        stopEngine = null;
        started = false;
        currentOffset = 0;
        currentLockOffset = 0;
        lockTarget = 0;
        lockSettling = false;
        currentKeyboardOpen = false;
        baselineHeight = 0;
        lastScrollAt = 0;
        currentState = INITIAL_STATE;
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

/**
 * Status pengukuran viewport secara real-time (untuk panel diagnosa).
 * Mengembalikan mode aktif beserta angka mentah pengukuran terakhir.
 */
export function useViewportAnchorState(): ViewportAnchorState {
  const [state, setState] = useState<ViewportAnchorState>(currentState);

  useEffect(() => {
    const listener: StateListener = (s) => setState(s);
    stateListeners.add(listener);
    setState(currentState);
    return () => {
      stateListeners.delete(listener);
    };
  }, []);

  return state;
}