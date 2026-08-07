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

function measure(): number {
  const vv = window.visualViewport;
  // `innerHeight` = layout viewport (ikut address bar, abaikan keyboard di
  // sebagian browser). Bila keyboard menyusutkan innerHeight, ambil nilai
  // terbesar antara innerHeight dan visualViewport height + offset agar
  // kompensasi keyboard tetap satu sumber.
  const inner = Math.round(window.innerHeight || 0);
  const visual = vv ? Math.round(vv.height + vv.offsetTop) : 0;
  return Math.max(inner, visual) || inner;
}

/** Pasang sinkronisasi `--app-vh`; kembalikan fungsi pembersih. */
export function startViewportHeightSync(): () => void {
  if (typeof window === "undefined") return () => {};
  const root = document.documentElement;
  let raf = 0;
  let last = -1;

  const apply = () => {
    raf = 0;
    const h = measure();
    if (h <= 0 || h === last) return;
    last = h;
    root.style.setProperty(APP_VH_VAR, `${h}px`);
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
