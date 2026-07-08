import { useEffect, useState, type RefObject } from "react";

/**
 * Melacak apakah kontainer yang scrollable punya konten yang menjulur di
 * atas dan/atau di bawah viewport-nya. Dipakai untuk menampilkan gradient
 * "fade" di sisi yang MASIH punya konten, sehingga user tahu ada tombol
 * yang bisa di-scroll ke pandangan.
 *
 * Return: `{ topShadow, bottomShadow }` — dua boolean yang dipetakan ke
 * `data-scroll-shadow="top|bottom|both|none"` di elemen host.
 */
export function useScrollShadow(ref: RefObject<HTMLElement | null>) {
  const [state, setState] = useState({ topShadow: false, bottomShadow: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.scrollTop > 2;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      setState((prev) =>
        prev.topShadow === top && prev.bottomShadow === bottom
          ? prev
          : { topShadow: top, bottomShadow: bottom },
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Konten anak berubah (mis. helpOpen toggle) → hitung ulang.
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref]);

  return state;
}
