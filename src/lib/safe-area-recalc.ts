/**
 * Recalculation safe-area saat rotasi layar.
 *
 * Masalah nyata di Android WebView / Chrome mobile: nilai
 * `env(safe-area-inset-bottom)` TIDAK langsung diperbarui saat perangkat
 * berpindah portrait <-> landscape. Selama beberapa frame nilainya masih
 * memakai inset orientasi lama, sehingga bar bawah bisa tertutup toolbar
 * browser / gesture bar.
 *
 * Solusi: ukur ulang inset lewat elemen probe (bukan mengandalkan satu
 * pembacaan), ulangi beberapa kali setelah orientationchange sampai nilainya
 * stabil, lalu publikasikan hasilnya sebagai CSS variable:
 *   --app-safe-top     : inset atas (notch / status bar)
 *   --app-safe-bottom  : inset bawah efektif (inset OS + overlap toolbar)
 *   --app-safe-left/right : inset samping (notch saat landscape)
 */

const VAR_TOP = "--app-safe-top";
const VAR_BOTTOM = "--app-safe-bottom";
const VAR_LEFT = "--app-safe-left";
const VAR_RIGHT = "--app-safe-right";

let probe: HTMLDivElement | null = null;
let started = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let last = { top: -1, bottom: -1, left: -1, right: -1 };

function ensureProbe(): HTMLDivElement {
  if (probe) return probe;
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:0",
    "height:0",
    "pointer-events:none",
    "visibility:hidden",
    "padding-top:env(safe-area-inset-top, 0px)",
    "padding-bottom:env(safe-area-inset-bottom, 0px)",
    "padding-left:env(safe-area-inset-left, 0px)",
    "padding-right:env(safe-area-inset-right, 0px)",
  ].join(";");
  document.body.appendChild(el);
  probe = el;
  return el;
}

/** Selisih antara layout viewport dan visual viewport = area yang ditutup
 *  toolbar browser (bukan keyboard). Diabaikan jika terlalu besar. */
function toolbarOverlap(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const gap = window.innerHeight - (vv.height + vv.offsetTop);
  if (!Number.isFinite(gap) || gap <= 0) return 0;
  // >180px hampir pasti keyboard, bukan toolbar → jangan tambahkan padding.
  return gap > 180 ? 0 : Math.round(gap);
}

function apply(): boolean {
  const el = ensureProbe();
  const cs = getComputedStyle(el);
  const rawTop = Math.round(parseFloat(cs.paddingTop) || 0);
  // Saat layar penuh, sebagian Android TETAP melaporkan inset atas sebesar
  // status bar meski bilahnya sudah disembunyikan → muncul pita kosong.
  // Tapi kalau perangkat punya notch/cutout nyata, inset itu WAJIB dipakai,
  // kalau tidak header justru terpotong. Bedakan lewat pengukuran:
  // hanya nolkan inset saat jendela BELUM setinggi layar fisik (artinya
  // bilah sistem masih memakan ruang dan inset-nya dobel).
  const isFullscreen =
    document.documentElement.dataset["displayMode"] === "fullscreen" ||
    !!document.fullscreenElement;
  const screenH = Math.round(window.screen?.height || 0);
  const occupiesFullScreen =
    screenH > 0 && Math.round(window.innerHeight) >= screenH - 4;
  // Cutout nyata: sisakan sebagian inset agar konten tidak masuk ke notch,
  // tapi jangan lebih dari 44px supaya tidak ada pita kosong berlebihan.
  const top =
    isFullscreen && !occupiesFullScreen ? 0 : Math.min(rawTop, 44);
  const bottomInset = parseFloat(cs.paddingBottom) || 0;
  const left = Math.round(parseFloat(cs.paddingLeft) || 0);
  const right = Math.round(parseFloat(cs.paddingRight) || 0);
  const bottom = Math.round(Math.max(bottomInset, toolbarOverlap()));

  const changed =
    top !== last.top ||
    bottom !== last.bottom ||
    left !== last.left ||
    right !== last.right;
  if (changed) {
    last = { top, bottom, left, right };
    const root = document.documentElement.style;
    root.setProperty(VAR_TOP, `${top}px`);
    root.setProperty(VAR_BOTTOM, `${bottom}px`);
    root.setProperty(VAR_LEFT, `${left}px`);
    root.setProperty(VAR_RIGHT, `${right}px`);
  }
  return changed;
}

/** Ukur ulang berulang kali: Android butuh beberapa ratus ms sampai inset
 *  orientasi baru benar-benar dilaporkan. */
function recalcBurst() {
  if (retryTimer) clearTimeout(retryTimer);
  const delays = [0, 60, 150, 300, 600, 1000];
  let i = 0;
  const step = () => {
    apply();
    i += 1;
    if (i < delays.length) {
      retryTimer = setTimeout(step, delays[i]! - delays[i - 1]!);
    } else {
      retryTimer = null;
    }
  };
  requestAnimationFrame(step);
}

export function startSafeAreaRecalc(): () => void {
  if (typeof window === "undefined" || started) return () => {};
  started = true;

  recalcBurst();

  const onOrientation = () => recalcBurst();
  const onResize = () => apply();

  window.addEventListener("orientationchange", onOrientation);
  window.addEventListener("resize", onResize);
  // Masuk/keluar layar penuh mengubah inset atas → ukur ulang.
  document.addEventListener("fullscreenchange", onOrientation);
  window.addEventListener("app-fullscreen-change", onOrientation);
  window.visualViewport?.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("scroll", onResize);
  const mq = window.matchMedia?.("(orientation: landscape)");
  mq?.addEventListener?.("change", onOrientation);

  return () => {
    started = false;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    window.removeEventListener("orientationchange", onOrientation);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("fullscreenchange", onOrientation);
    window.removeEventListener("app-fullscreen-change", onOrientation);
    window.visualViewport?.removeEventListener("resize", onResize);
    window.visualViewport?.removeEventListener("scroll", onResize);
    mq?.removeEventListener?.("change", onOrientation);
    probe?.remove();
    probe = null;
    last = { top: -1, bottom: -1, left: -1, right: -1 };
  };
}
