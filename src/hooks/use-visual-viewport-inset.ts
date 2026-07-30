import { useEffect, useState } from "react";

/**
 * Melacak selisih antara layout viewport (window.innerHeight) dan visual
 * viewport (window.visualViewport.height). Selisih ini muncul ketika:
 *  - soft-keyboard Android/iOS terbuka
 *  - toolbar browser Android muncul/menghilang saat scroll
 *  - orientasi berubah (potret ↔ lanskap) — visualViewport diperbarui
 *    setelah `orientationchange`
 *
 * Nilai balik (px, ≥0) adalah jumlah ruang di bawah layout viewport yang
 * TERTUTUP oleh keyboard/toolbar sistem. UI `fixed`-positioned yang
 * "menempel di bawah" harus mengurangi tinggi / menambah `bottom` sebesar
 * angka ini agar tetap terlihat.
 *
 * Aman dipanggil saat SSR: fallback 0 sebelum efek `useEffect` berjalan.
 */
export function useVisualViewportKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) {
      // Browser lama tanpa visualViewport: tidak ada sinyal keyboard.
      return;
    }

    let raf = 0;
    // Timer untuk menyelesaikan race pada `orientationchange`: banyak
    // Android WebView / Chrome mem-fire event ini SEBELUM
    // `visualViewport.height` & `window.innerHeight` selesai settle,
    // sehingga sampel pertama masih memakai tinggi lama. Kita sampling
    // ulang beberapa kali sampai 500ms untuk menangkap nilai final tanpa
    // menunggu keyboard menutup.
    const timers: number[] = [];
    const clearTimers = () => {
      while (timers.length) {
        window.clearTimeout(timers.shift()!);
      }
    };
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // `offsetTop` menutup kasus keyboard iOS yang menggeser visualViewport
        // ke atas alih-alih mengecilkan tinggi.
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        // Ambang 1px menghindari flicker akibat sub-pixel rounding saat
        // toolbar browser bergerak halus.
        setInset((prev) => (Math.abs(prev - kb) < 1 ? prev : Math.round(kb)));
      });
    };
    const scheduleResample = () => {
      clearTimers();
      // 60/160/320/500ms — cukup untuk menangkap settle
      // visualViewport pasca-rotasi di WebView, Chrome, dan Samsung
      // Internet tanpa banjir setState (guarded oleh ambang 1px + rAF).
      for (const delay of [60, 160, 320, 500]) {
        timers.push(window.setTimeout(update, delay));
      }
    };
    const onOrientationOrResize = () => {
      update();
      scheduleResample();
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("orientationchange", onOrientationOrResize);
    // `resize` window juga mem-fire pada rotasi + saat toolbar browser
    // Android muncul/hilang. Kita sampling ulang untuk kasus rotasi.
    window.addEventListener("resize", onOrientationOrResize);
    // `screen.orientation.change` — API modern yang lebih reliabel di
    // Chrome/Android dibanding `orientationchange` yang deprecated.
    const so = typeof screen !== "undefined" ? screen.orientation : undefined;
    so?.addEventListener?.("change", onOrientationOrResize);

    return () => {
      cancelAnimationFrame(raf);
      clearTimers();
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", onOrientationOrResize);
      window.removeEventListener("resize", onOrientationOrResize);
      so?.removeEventListener?.("change", onOrientationOrResize);
    };
  }, []);

  return inset;
}
