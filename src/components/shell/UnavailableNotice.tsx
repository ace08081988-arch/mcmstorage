import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Lencana kecil "Tidak tersedia" — dipakai menempel di judul kartu/menu yang
 * belum punya data supaya jelas bukan error, hanya belum ada isinya.
 */
export function UnavailableBadge({
  label = "Tidak tersedia",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-ms-2xs font-medium text-muted-foreground ${className}`}
    >
      <AlertCircle className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

/**
 * Panel "Tidak tersedia" + satu tombol menuju halaman yang benar.
 * Dipakai ketika sebuah fitur/tautan belum punya data, supaya pengguna tidak
 * berhenti di jalan buntu tetapi langsung diarahkan ke tempat mengisinya.
 */
export function UnavailableNotice({
  title = "Tidak tersedia",
  description,
  actionLabel,
  to,
  search,
  params,
  onAction,
  className = "",
}: {
  title?: string;
  description?: ReactNode;
  actionLabel: string;
  /** Rute tujuan. Kalau kosong, pakai `onAction`. */
  to?: string;
  search?: Record<string, unknown>;
  params?: Record<string, unknown>;
  onAction?: () => void;
  className?: string;
}) {
  const actionCls =
    "inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-ms-4 text-ms-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div
      role="status"
      className={`rounded-2xl border border-dashed border-border/70 bg-card/40 p-ms-4 text-center ${className}`}
    >
      <UnavailableBadge label={title} />
      {description && (
        <p className="mx-auto mt-ms-2 max-w-sm text-ms-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {description}
        </p>
      )}
      <div className="mt-ms-3 flex justify-center">
        {to ? (
          <Link
            to={to}
            {...(search ? { search } : {})}
            {...(params ? { params } : {})}
            className={actionCls}
          >
            {actionLabel}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : (
          <button type="button" onClick={onAction} className={actionCls}>
            {actionLabel}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
