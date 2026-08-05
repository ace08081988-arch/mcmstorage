import { useEffect, type RefObject } from "react";

/**
 * Sinkronisasi tinggi bar bawah nyata -> `--app-bottom-nav-h`.
 *
 * Sebelumnya tinggi ini ditebak lewat konstanta CSS (3.75rem / 3rem +
 * safe-area). Tebakan itu meleset setiap kali isi bar berubah tinggi:
 * badge notifikasi muncul/berganti ukuran ("9" -> "99+"), placeholder
 * shimmer saat memuat, label mengecil di landscape, atau safe-area
 * dihitung ulang setelah rotasi. Akibatnya konten bisa tertutup bar
 * (padding kurang) atau menyisakan area kosong (padding berlebih).
 *
 * Solusi: ukur elemen bar sungguhan dengan ResizeObserver dan publikasikan
 * hasilnya sebagai CSS variable yang sudah dipakai layout konten & FAB.
 * Saat bar dilepas (unmount / disembunyikan di desktop), variabel
 * dikembalikan ke nilai bawaan CSS.
 */
export function useBottomNavHeightSync(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
) {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!enabled || !el || typeof ResizeObserver === "undefined") {
      root.style.removeProperty("--app-bottom-nav-h");
      root.style.setProperty("--app-bottom-bar-space", "0px");
      delete root.dataset["bottomBar"];
      return;
    }

    let last = -1;
    const publish = () => {
      // getBoundingClientRect ikut menghitung padding safe-area & border,
      // jadi angkanya persis ruang layar yang ditutupi bar.
      const h = Math.round(el.getBoundingClientRect().height);
      if (h <= 0 || h === last) return;
      last = h;
      root.style.setProperty("--app-bottom-nav-h", `${h}px`);
      // Spacer otomatis: 0px saat tidak ada bar, tinggi nyata saat ada.
      // Dipakai utility `app-bottom-spacer` di layout supaya konten
      // terakhir tidak pernah tertutup bar di halaman mana pun.
      root.style.setProperty("--app-bottom-bar-space", `${h}px`);
      root.dataset["bottomBar"] = "1";
    };

    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);

    // Rotasi / recalculation safe-area mengubah padding bar tanpa memicu
    // ResizeObserver di sebagian WebView Android — ukur ulang eksplisit.
    const onViewport = () => requestAnimationFrame(publish);
    window.addEventListener("orientationchange", onViewport);
    window.addEventListener("resize", onViewport);

    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", onViewport);
      window.removeEventListener("resize", onViewport);
      root.style.removeProperty("--app-bottom-nav-h");
      root.style.setProperty("--app-bottom-bar-space", "0px");
      delete root.dataset["bottomBar"];
    };
  }, [ref, enabled]);
}
