import type { ReactNode } from "react";

/**
 * Pembungkus ringan untuk item daftar/grid yang panjang.
 *
 * Grid kartu (Ecer / Request) tidak bisa memakai `VirtualizedList` karena
 * layoutnya multi-kolom. Sebagai gantinya kita pakai `content-visibility:
 * auto`: browser melewati layout, style, dan paint untuk kartu yang berada
 * di luar viewport, tetapi DOM-nya tetap utuh sehingga Ctrl+F, screenshot,
 * dan scroll-anchoring tetap normal.
 *
 * `contain-intrinsic-size: auto <h>` membuat tinggi terakhir yang terukur
 * diingat, jadi scrollbar tidak melompat saat kartu masuk/keluar viewport —
 * ini penting di Android WebView yang scroll-anchoring-nya sensitif.
 */
export function PaintDeferred({
  children,
  minHeight = 200,
  className,
}: {
  children: ReactNode;
  /** Perkiraan tinggi kartu (px) sebelum sempat diukur. */
  minHeight?: number;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${minHeight}px`,
      }}
    >
      {children}
    </div>
  );
}

export default PaintDeferred;
