import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown } from "lucide-react";

export type ScrollSection = { id: string; label: string };

/**
 * Indikator posisi scroll + navigasi cepat untuk dialog dengan konten panjang.
 * - Menampilkan progress bar tipis (0–100%) berdasarkan posisi scroll pada
 *   container (DialogContent yang overflow-y-auto).
 * - Bila `sections` diberikan, menampilkan label bagian yang sedang aktif
 *   berdasarkan elemen dengan id yang cocok yang paling dekat ke atas viewport
 *   container.
 * - Menyediakan tombol "Kembali ke atas" dan "Lompat ke bagian berikutnya"
 *   agar pengguna tidak perlu menggulir panjang di HP.
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

  const activeIndex = sections?.findIndex((s) => s.id === activeId) ?? -1;
  const activeLabel = sections?.find((s) => s.id === activeId)?.label;
  const nextSection = sections && activeIndex >= 0 && activeIndex < sections.length - 1
    ? sections[activeIndex + 1]
    : null;

  function scrollToTop() {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scrollToNext() {
    const el = containerRef.current;
    if (!el) return;
    if (nextSection) {
      const node = el.querySelector<HTMLElement>(`#${CSS.escape(nextSection.id)}`);
      if (node) {
        const headerOffset = 96; // ruang untuk header sticky + sedikit padding
        el.scrollTo({ top: Math.max(0, node.offsetTop - headerOffset), behavior: "smooth" });
      }
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }

  const canGoBack = progress > 2;
  const canGoNext = sections && sections.length > 0 && progress < 98;

  return (
    <div className={`${className}`}>
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
      {sections && sections.length > 0 ? (
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={scrollToTop}
            disabled={!canGoBack}
            className="h-7 flex-1 gap-1 px-2 text-[10px] disabled:opacity-30"
            aria-label="Kembali ke atas form"
            title="Kembali ke atas form"
          >
            <ArrowUp className="h-3 w-3 shrink-0" />
            <span className="hidden min-w-0 truncate sm:inline">Kembali ke atas</span>
            <span className="sm:hidden">Atas</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={scrollToNext}
            disabled={!canGoNext}
            className="h-7 flex-1 gap-1 px-2 text-[10px] disabled:opacity-30"
            aria-label={nextSection ? `Lompat ke bagian ${nextSection.label}` : "Lompat ke bawah form"}
            title={nextSection ? `Lompat ke ${nextSection.label}` : "Lompat ke bawah form"}
          >
            <span className="min-w-0 truncate">
              {nextSection ? `Lompat ke ${nextSection.label}` : "Lompat ke bawah"}
            </span>
            <ArrowDown className="h-3 w-3 shrink-0" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
