import { useMemo } from "react";
import { Check, CircleDot, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type SaveStatus = "clean" | "dirty" | "saving";

/**
 * Turunkan status simpan dari perbandingan snapshot awal vs current.
 * - busy=true → "saving"
 * - JSON sama → "clean" (Tersimpan)
 * - JSON beda → "dirty" (Perubahan belum tersimpan)
 */
export function useSaveStatus<T>(current: T, initial: T, busy: boolean): SaveStatus {
  return useMemo<SaveStatus>(() => {
    if (busy) return "saving";
    try {
      return JSON.stringify(current) === JSON.stringify(initial) ? "clean" : "dirty";
    } catch {
      return "dirty";
    }
  }, [current, initial, busy]);
}

const STYLES: Record<SaveStatus, { label: string; icon: React.ReactNode; wrap: string }> = {
  clean: {
    label: "Tersimpan",
    icon: <Check className="h-3 w-3" aria-hidden />,
    wrap: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  dirty: {
    label: "Perubahan belum tersimpan",
    icon: <CircleDot className="h-3 w-3" aria-hidden />,
    wrap: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  },
  saving: {
    label: "Menyimpan…",
    icon: <Loader2 className="h-3 w-3 animate-spin" aria-hidden />,
    wrap: "border-primary/40 bg-primary/10 text-primary",
  },
};

export function DialogSaveStatus({
  status,
  className,
  compact = false,
}: {
  status: SaveStatus;
  className?: string;
  /** compact = tampilan lebih kecil untuk sticky footer. */
  compact?: boolean;
}) {
  const s = STYLES[status];
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium",
        compact ? "text-[10px]" : "text-[11px]",
        s.wrap,
        className,
      )}
    >
      {s.icon}
      <span className="truncate">{s.label}</span>
    </div>
  );
}