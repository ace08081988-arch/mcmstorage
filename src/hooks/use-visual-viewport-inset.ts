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

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    // `resize` window juga mem-fire pada rotasi + saat toolbar browser
    // Android muncul/hilang.
    window.addEventListener("resize", update);

    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return inset;
}
