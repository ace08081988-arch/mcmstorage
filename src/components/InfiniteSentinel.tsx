import * as React from "react";

/**
 * Sentinel infinite-scroll yang dipakai bersama oleh daftar histori.
 * Memanggil `onLoadMore()` saat elemen terlihat (rootMargin 200px), dan
 * menyediakan tombol fallback "Muat lebih banyak" untuk WebView lawas
 * yang tidak mendukung IntersectionObserver.
 */
export function InfiniteSentinel({
  hasMore,
  loading,
  onLoadMore,
  label = "Memuat data lainnya…",
  doneLabel,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  label?: string;
  doneLabel?: string;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const cb = React.useRef(onLoadMore);
  cb.current = onLoadMore;

  React.useEffect(() => {
    if (!hasMore) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore]);

  if (!hasMore) {
    return doneLabel ? (
      <div className="py-3 text-center text-[11px] text-muted-foreground">{doneLabel}</div>
    ) : null;
  }

  return (
    <div ref={ref} className="flex justify-center py-3">
      {loading ? (
        <span className="text-xs text-muted-foreground">{label}</span>
      ) : (
        <button
          type="button"
          onClick={() => cb.current()}
          className="rounded-full border px-3 py-1 text-xs hover:bg-accent"
        >
          Muat lebih banyak
        </button>
      )}
    </div>
  );
}
