import * as React from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

/**
 * Daftar virtual berbasis window scroll.
 *
 * Di bawah `threshold` item, daftar dirender biasa (hindari overhead virtualisasi
 * untuk data sedikit). Di atas itu, hanya baris yang terlihat yang dirender
 * sehingga UI tetap responsif walau data ratusan/ribuan baris.
 */
export function VirtualizedList<T>({
  items,
  getKey,
  renderItem,
  estimateSize = 88,
  overscan = 6,
  threshold = 8,
  gap = 8,
  className,
}: {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateSize?: number;
  overscan?: number;
  threshold?: number;
  /** jarak antar baris (px) */
  gap?: number;
  className?: string;
}) {
  const parentRef = React.useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = React.useState(0);
  const enabled = items.length > threshold;

  React.useLayoutEffect(() => {
    if (!enabled) return;
    const el = parentRef.current;
    if (!el) return;
    const update = () =>
      setOffset(el.getBoundingClientRect().top + window.scrollY);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [enabled]);

  const virtualizer = useWindowVirtualizer({
    count: enabled ? items.length : 0,
    estimateSize: () => estimateSize + gap,
    overscan,
    scrollMargin: offset,
  });

  if (!enabled) {
    return (
      <div className={className} style={{ display: "grid", rowGap: gap }}>
        {items.map((item, i) => (
          <div
            key={getKey(item, i)}
            // Lewati paint/layout untuk baris di luar viewport — hemat CPU saat
            // scroll di HP tanpa mengubah tinggi/urutan konten.
            style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${estimateSize}px` }}
          >
            {renderItem(item, i)}
          </div>
        ))}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className={className}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtualItems.map((v) => {
          const item = items[v.index];
          return (
            <div
              key={getKey(item, v.index)}
              data-index={v.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)`,
                paddingBottom: gap,
              }}
            >
              {renderItem(item, v.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
