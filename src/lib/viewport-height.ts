/**
 * Tinggi viewport yang benar-benar terlihat.
 *
 * Masalah: `100vh` memakai tinggi layar TERBESAR (address bar tersembunyi),
 * dan `100dvh` di sebagian Android WebView/Chrome lama tidak ikut menyusut
 * saat bilah alamat muncul. Akibatnya konten (mis. daftar chat & composer)
 * terpotong di bawah bilah alamat.
 *
 * Solusi: tulis tinggi layout viewport nyata (`window.innerHeight`) ke
 * variabel CSS `--app-vh`. `innerHeight` sudah mengikuti munculnya/hilangnya
 * bilah alamat, dan TIDAK dipakai untuk kompensasi keyboard (itu ditangani
 * `use-visual-viewport-inset`), jadi tidak ada pengurangan ganda.
 */

export const APP_VH_VAR = "--app-vh";
export const APP_VH_VISIBLE_VAR = "--app-vh-visible";

function measure(): number {
  const vv = window.visualViewport;
  // `innerHeight` = layout viewport (ikut address bar, abaikan keyboard di
  // sebagian browser). Bila keyboard menyusutkan innerHeight, ambil nilai
  // terbesar antara innerHeight dan visualViewport height + offset agar
  // kompensasi keyboard tetap satu sumber.
  const inner = Math.round(window.innerHeight || 0);
  const visual = vv ? Math.round(vv.height + vv.offsetTop) : 0;
  const h = Math.max(inner, visual) || inner;
  // Jangan pernah melebihi tinggi layar fisik: sebagian WebView melaporkan
  // innerHeight lebih besar dari layar saat transisi fullscreen sehingga
  // bagian bawah konten terpotong.
  const screenH = Math.round(window.screen?.height || 0);
  return screenH > 0 ? Math.min(h, screenH) : h;
}

/** Tinggi area yang benar-benar terlihat (toolbar/keyboard sudah dipotong). */
function measureVisible(): number {
  const vv = window.visualViewport;
  if (vv?.height) return Math.round(vv.height);
  return Math.round(window.innerHeight || 0);
}

/** Pasang sinkronisasi `--app-vh`; kembalikan fungsi pembersih. */
export function startViewportHeightSync(): () => void {
  if (typeof window === "undefined") return () => {};
  const root = document.documentElement;
  let raf = 0;
  let last = -1;
  let lastVisible = -1;

  const apply = () => {
    raf = 0;
    const h = measure();
    if (h > 0 && h !== last) {
      last = h;
      root.style.setProperty(APP_VH_VAR, `${h}px`);
    }
    const v = measureVisible();
    if (v > 0 && v !== lastVisible) {
      lastVisible = v;
      root.style.setProperty(APP_VH_VISIBLE_VAR, `${v}px`);
    }
  };
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(apply);
  };

  apply();
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);

  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("scroll", schedule);
  };
}
