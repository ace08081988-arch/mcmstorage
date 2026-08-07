import * as React from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  armListPerfFlush,
  recordListMount,
  recordListRender,
} from "@/lib/list-perf";

/**
 * Ukur durasi commit render daftar + hitung jumlah re-render, lalu
 * setorkan ke registry `list-perf`. Biayanya dua `performance.now()`
 * per render — cukup murah untuk dibiarkan aktif di produksi.
 */
function useListRenderMetrics(list: string, items: number, rendered: number) {
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : 0;
  const route =
    typeof window !== "undefined" ? window.location.pathname : "ssr";

  React.useEffect(() => {
    armListPerfFlush();
    recordListMount(route, list);
    // hanya saat mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (typeof performance === "undefined") return;
    recordListRender(route, list, performance.now() - startedAt, items, rendered);
  });
}

/**
 * Cache tinggi baris per key, bertahan antar mount/unmount (dan antar
 * kunjungan halaman) sehingga estimasi awal langsung akurat: scrollbar
 * tidak melompat dan virtualizer tidak perlu re-measure → re-render
 * berulang saat isi daftar berubah.
 */
const measureCaches = new Map<string, Map<string, number>>();

function getCache(namespace: string): Map<string, number> {
  let c = measureCaches.get(namespace);
  if (!c) {
    c = new Map();
    measureCaches.set(namespace, c);
  }
  return c;
}

/** Buang cache tinggi baris (mis. saat sumber data diganti total). */
export function clearRowHeightCache(namespace?: string) {
  if (namespace) measureCaches.delete(namespace);
  else measureCaches.clear();
}

/** Baris yang hanya re-render saat key/konten baris itu sendiri berubah. */
const Row = React.memo(
  function Row({ children }: { children: React.ReactNode; deps?: unknown }) {
    return <>{children}</>;
  },
  (prev, next) => prev.deps === next.deps,
);

/**
 * Overscan adaptif: jumlah baris ekstra dihitung dari tinggi viewport
 * dibagi tinggi baris, bukan angka tetap. Di Android WebView (memori &
 * GPU terbatas) buffer besar bikin scroll tersendat karena terlalu banyak
 * node dipaint sekaligus; buffer terlalu kecil bikin baris blank saat
 * fling. Kompromi: ~0.6 layar buffer di perangkat low-end, ~1 layar di
 * desktop, dan selalu dibatasi 2–8 baris.
 */
function useAdaptiveOverscan(rowHeight: number): number {
  const compute = React.useCallback(() => {
    if (typeof window === "undefined") return 4;
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      hardwareConcurrency?: number;
    };
    const lowEnd =
      (nav.deviceMemory ?? 8) <= 4 ||
      (nav.hardwareConcurrency ?? 8) <= 4 ||
      window.innerWidth < 768;
    const screens = lowEnd ? 0.6 : 1;
    const rows = Math.ceil((window.innerHeight * screens) / Math.max(40, rowHeight));
    return Math.min(8, Math.max(2, rows));
  }, [rowHeight]);

  const [value, setValue] = React.useState(compute);

  React.useEffect(() => {
    const update = () => setValue(compute());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [compute]);

  return value;
}

/**
 * Daftar virtual berbasis window scroll.
 *
 * Di bawah `threshold` item, daftar dirender biasa (hindari overhead virtualisasi
 * untuk data sedikit). Di atas itu, hanya baris yang terlihat yang dirender
 * sehingga UI tetap responsif walau data ratusan/ribuan baris.
 *
 * Tinggi tiap baris diukur otomatis (`measureElement`) lalu disimpan di cache
 * per-key, jadi baris yang pernah terlihat langsung memakai tinggi aslinya.
 */
export function VirtualizedList<T>({
  items,
  getKey,
  renderItem,
  estimateSize = 88,
  overscan,
  threshold = 8,
  gap = 8,
  className,
  cacheKey = "default",
}: {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateSize?: number;
  /**
   * Jumlah baris ekstra di luar viewport. Default: dihitung otomatis dari
   * tinggi viewport & tinggi baris (lihat `useAdaptiveOverscan`).
   */
  overscan?: number;
  threshold?: number;
  /** jarak antar baris (px) */
  gap?: number;
  className?: string;
  /** Namespace cache tinggi baris; pakai nilai unik per daftar. */
  cacheKey?: string;
}) {
  const parentRef = React.useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = React.useState(0);
  const enabled = items.length > threshold;
  const cache = React.useMemo(() => getCache(cacheKey), [cacheKey]);
  const autoOverscan = useAdaptiveOverscan(estimateSize + gap);
  const effectiveOverscan = overscan ?? autoOverscan;

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

  const keys = React.useMemo(
    () => items.map((item, i) => getKey(item, i)),
    // getKey diasumsikan murni; ikut items saja supaya identitas stabil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  );

  const virtualizer = useWindowVirtualizer({
    count: enabled ? items.length : 0,
    estimateSize: (index) => {
      const cached = cache.get(keys[index]);
      return cached != null ? cached : estimateSize + gap;
    },
    overscan: effectiveOverscan,
    scrollMargin: offset,
  });

  // Simpan hasil pengukuran nyata ke cache agar mount berikutnya akurat.
  const measure = React.useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      const idx = Number(el.getAttribute("data-index"));
      const key = Number.isFinite(idx) ? keys[idx] : undefined;
      // Saat fling di WebView, pengukuran ulang baris yang tingginya sudah
      // diketahui memicu layout sinkron per frame. Lewati selama scroll.
      if (virtualizer.isScrolling && key && cache.has(key)) return;
      virtualizer.measureElement(el);
      const h = el.getBoundingClientRect().height;
      if (key && h > 0 && cache.get(key) !== h) cache.set(key, h);
    },
    [virtualizer, keys, cache],
  );

  const virtualItems = enabled ? virtualizer.getVirtualItems() : [];
  useListRenderMetrics(
    cacheKey,
    items.length,
    enabled ? virtualItems.length : items.length,
  );

  if (!enabled) {
    return (
      <div className={className} style={{ display: "grid", rowGap: gap }}>
        {items.map((item, i) => (
          <div
            key={keys[i]}
            // Lewati paint/layout untuk baris di luar viewport — hemat CPU saat
            // scroll di HP tanpa mengubah tinggi/urutan konten.
            style={{
              contentVisibility: "auto",
              containIntrinsicSize: `auto ${cache.get(keys[i]) ?? estimateSize}px`,
            }}
          >
            <Row deps={item}>{renderItem(item, i)}</Row>
          </div>
        ))}
      </div>
    );
  }

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
              key={keys[v.index]}
              data-index={v.index}
              ref={measure}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)`,
                paddingBottom: gap,
                // Batasi dampak layout/paint tiap baris ke dirinya sendiri
                // supaya scroll tidak memicu reflow seluruh daftar.
                contain: "layout paint style",
              }}
            >
              <Row deps={item}>{renderItem(item, v.index)}</Row>
            </div>
          );
        })}
      </div>
    </div>
  );
}
