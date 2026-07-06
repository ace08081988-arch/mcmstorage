import { useEffect, useRef, useState, type RefObject } from "react";

export type ScrollSection = { id: string; label: string };

/**
 * Indikator posisi scroll untuk dialog dengan konten panjang.
 * - Menampilkan progress bar tipis (0–100%) berdasarkan posisi scroll pada
 *   container (DialogContent yang overflow-y-auto).
 * - Bila `sections` diberikan, menampilkan label bagian yang sedang aktif
 *   berdasarkan elemen dengan id yang cocok yang paling dekat ke atas viewport
 *   container.
 *
 * Letakkan di dalam DialogHeader sticky agar selalu terlihat saat scroll.
 */
export function DialogScrollProgress({
  containerRef,
  sections,
  className = "",
}: {
  containerRef: RefObject<HTMLElement | null>;
  sections?: ScrollSection[];
  className?: string;
}) {
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(sections?.[0]?.id ?? null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      rafRef.current = null;
      const max = el.scrollHeight - el.clientHeight;
      const pct = max > 0 ? Math.min(100, Math.max(0, (el.scrollTop / max) * 100)) : 0;
      setProgress(pct);

      if (sections && sections.length > 0) {
        const containerTop = el.getBoundingClientRect().top;
        // threshold sedikit di bawah header sticky
        const threshold = containerTop + 80;
        let current = sections[0]!.id;
        for (const s of sections) {
          const node = el.querySelector<HTMLElement>(`#${CSS.escape(s.id)}`);
          if (!node) continue;
          const top = node.getBoundingClientRect().top;
          if (top <= threshold) current = s.id;
        }
        setActiveId(current);
      }
    };

    const schedule = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(compute);
    };

    compute();
    el.addEventListener("scroll", schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", schedule);
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, sections]);

  const activeLabel = sections?.find((s) => s.id === activeId)?.label;

  return (
    <div className={`pointer-events-none select-none ${className}`}>
      {activeLabel ? (
        <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="truncate">{activeLabel}</span>
          <span className="tabular-nums">{Math.round(progress)}%</span>
        </div>
      ) : null}
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-label="Posisi scroll form"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}