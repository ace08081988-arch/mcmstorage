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

    /**
     * Rotasi portrait <-> landscape: tinggi bar dan safe-area inset baru
     * baru stabil beberapa ratus ms setelah event. Satu pengukuran saja
     * sering merekam nilai orientasi lama sehingga spacer meleset dan
     * konten/bilah tampak bergeser. Karena itu: reset dedupe lalu ukur
     * ulang berulang sampai layout benar-benar settle.
     */
    let burstTimer: ReturnType<typeof setTimeout> | null = null;
    const remeasureBurst = () => {
      if (burstTimer) clearTimeout(burstTimer);
      const delays = [0, 60, 150, 300, 600, 1000];
      let i = 0;
      const step = () => {
        last = -1; // paksa publish walau hasil ukur sama dengan sebelumnya
        publish();
        i += 1;
        if (i < delays.length) {
          burstTimer = setTimeout(step, delays[i]! - delays[i - 1]!);
        } else {
          burstTimer = null;
        }
      };
      requestAnimationFrame(step);
    };

    window.addEventListener("orientationchange", remeasureBurst);
    window.addEventListener("resize", onViewport);
    window.visualViewport?.addEventListener("resize", onViewport);
    const mqLandscape = window.matchMedia?.("(orientation: landscape)");
    mqLandscape?.addEventListener?.("change", remeasureBurst);
    const so = window.screen?.orientation;
    so?.addEventListener?.("change", remeasureBurst);

    return () => {
      ro.disconnect();
      if (burstTimer) clearTimeout(burstTimer);
      window.removeEventListener("orientationchange", remeasureBurst);
      window.removeEventListener("resize", onViewport);
      window.visualViewport?.removeEventListener("resize", onViewport);
      mqLandscape?.removeEventListener?.("change", remeasureBurst);
      so?.removeEventListener?.("change", remeasureBurst);
      root.style.removeProperty("--app-bottom-nav-h");
      root.style.setProperty("--app-bottom-bar-space", "0px");
      delete root.dataset["bottomBar"];
    };
  }, [ref, enabled]);
}
