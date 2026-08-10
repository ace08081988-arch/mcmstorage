import { useEffect, useMemo, useRef } from "react";
import { Check, CircleDot, Loader2 } from "lucide-react";
import { toast } from "sonner";
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

/**
 * Terjemahkan transisi status simpan menjadi toast otomatis:
 *
 *   saving → clean  ⇒ toast.success(opts.successMessage ?? "Tersimpan")
 *   saving → dirty  ⇒ toast.error(opts.errorMessage ?? "Perubahan gagal disimpan")
 *
 * Transisi lain (clean↔dirty saat user mengetik, saving pertama kali)
 * di-abaikan. Cocok dipasang sekali di komponen dialog supaya handler
 * `save()` cukup mengeset state error tanpa memanggil `toast.error`
 * sendiri — sumber kebenaran toast = badge status.
 *
 * `errorMessage` dibaca dengan `useRef` supaya perubahan pesan yang
 * di-set di dalam blok `catch` tepat sebelum `setBusy(false)` terlihat
 * saat effect transisi berjalan (React membatch update state).
 *
 * `enabled=false` mematikan hook — berguna kalau dialog tertentu
 * masih mau memakai toast handler-level sendiri.
 */
export function useSaveStatusToast(
  status: SaveStatus,
  opts?: {
    successMessage?: string;
    errorMessage?: string | null;
    enabled?: boolean;
  },
): void {
  const prevRef = useRef<SaveStatus>(status);
  // Baca pesan via ref supaya nilai terbaru terbaca saat transisi
  // (setState errorMessage + setBusy(false) sering ter-batch).
  const successMsg = opts?.successMessage ?? "Tersimpan";
  const errorMsg = opts?.errorMessage;
  const successRef = useRef(successMsg);
  const errorRef = useRef<string | null | undefined>(errorMsg);
  successRef.current = successMsg;
  errorRef.current = errorMsg;

  const enabled = opts?.enabled !== false;

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = status;
    if (!enabled) return;
    if (prev !== "saving") return;
    if (status === "clean") {
      toast.success(successRef.current);
    } else if (status === "dirty") {
      toast.error(errorRef.current || "Perubahan gagal disimpan");
    }
  }, [status, enabled]);
}

/**
 * Konfirmasi buang perubahan saat dialog ditutup dengan status "dirty".
 * Return `true` kalau aman ditutup (bersih/simpan sedang jalan → jangan
 * ganggu, atau user setuju buang perubahan). Return `false` kalau user
 * membatalkan penutupan.
 *
 * Dipakai di handler `onOpenChange` Dialog: kalau `false`, jangan
 * panggil `onClose()`.
 */
export function confirmDiscardIfDirty(status: SaveStatus): boolean {
  if (status !== "dirty") return true;
  if (typeof window === "undefined") return true;
  return window.confirm(
    "Perubahan belum tersimpan akan hilang. Tetap tutup dialog?",
  );
}

const STYLES: Record<SaveStatus, { label: string; icon: React.ReactNode; wrap: string }> = {
  clean: {
    label: "Tersimpan",
    icon: <Check className="h-3 w-3" aria-hidden />,
    wrap: "border-success/40 bg-success/10 text-success dark:text-success",
  },
  dirty: {
    label: "Perubahan belum tersimpan",
    icon: <CircleDot className="h-3 w-3" aria-hidden />,
    wrap: "border-warning/40 bg-warning/10 text-warning dark:text-warning",
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
        "inline-flex items-center gap-ms-1 rounded-full border px-ms-2 py-0.5 font-medium",
        compact ? "text-ms-2xs" : "text-ms-2xs",
        s.wrap,
        className,
      )}
    >
      {s.icon}
      <span className="truncate">{s.label}</span>
    </div>
  );
}