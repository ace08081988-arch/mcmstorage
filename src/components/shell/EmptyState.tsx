import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Empty state standar aplikasi: ikon dalam badge, judul, penjelasan singkat,
 * lalu aksi. Dipakai daftar produk & daftar status kirim supaya kondisi
 * "kosong" selalu terbaca sama di seluruh aplikasi.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={`rounded-2xl border border-dashed border-border/70 bg-card/40 p-ms-5 text-center ${className}`}
    >
      <span className="mx-auto mb-ms-3 grid h-12 w-12 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-ms-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-ms-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {description}
        </p>
      )}
      {actions && (
        <div className="mt-ms-3 flex flex-wrap items-center justify-center gap-ms-2">
          {actions}
        </div>
      )}
    </div>
  );
}

/** Skeleton daftar generik — dipakai saat data pertama kali dimuat. */
export function ListSkeleton({
  rows = 4,
  withMedia = true,
  label = "Memuat data…",
}: {
  rows?: number;
  withMedia?: boolean;
  label?: string;
}) {
  return (
    <div className="space-ms-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-ms-3 rounded-xl border border-border/50 bg-card/50 p-ms-3"
        >
          {withMedia && (
            <div className="h-11 w-11 shrink-0 animate-pulse rounded-lg bg-muted/70" />
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted/70" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted/50" />
          </div>
          <div className="h-6 w-14 shrink-0 animate-pulse rounded-full bg-muted/50" />
        </div>
      ))}
    </div>
  );
}

/** Pita tipis "menyegarkan data" untuk refetch di belakang layar. */
export function RefreshingBar({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      aria-live="polite"
      className="flex items-center gap-ms-2 rounded-full border border-border/60 bg-card/70 px-ms-3 py-1 text-ms-2xs text-muted-foreground"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden />
      Menyegarkan data…
    </div>
  );
}
