/**
 * Kartu ringkasan angka (Total Produk / Stok Menipis / dsb.).
 * Diekstrak dari /gudang supaya halaman lain (mis. /ecer, dashboard,
 * riwayat) memakai bentuk & spacing yang sama tanpa drift.
 *
 * API sengaja stabil: props sama persis dengan versi lama di /gudang.
 */
import type { ComponentType } from "react";

export type SummaryTone = "primary" | "warning" | "danger" | "info";

const TONE_CLASS: Record<SummaryTone, string> = {
  primary: "text-primary bg-primary/10 ring-primary/20",
  warning: "text-amber-600 bg-amber-500/10 ring-amber-500/20 dark:text-amber-400",
  danger: "text-destructive bg-destructive/10 ring-destructive/20",
  info: "text-sky-600 bg-sky-500/10 ring-sky-500/20 dark:text-sky-400",
};

export interface SummaryCardProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  /** Angka mentah; akan diformat ke locale id-ID. Berikan string untuk override. */
  value: number | string;
  tone: SummaryTone;
  loading?: boolean;
}

export function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
  loading,
}: SummaryCardProps) {
  const display = typeof value === "number" ? value.toLocaleString("id-ID") : value;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-b from-card to-background p-ms-3 elev-sm backdrop-blur transition-all hover:border-primary/40 hover:elev-md md:p-ms-4">
      <div className="flex items-start justify-between gap-ms-2">
        <div className="min-w-0 flex-1">
          {/* tracking di-relax pada mobile agar label 12-char seperti
              "TOTAL PRODUK" muat di kolom kartu di viewport 390px tanpa
              ter-truncate. Di ≥ md kembali ke 0.18em untuk identitas. */}
          <p className="truncate text-ms-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:tracking-[0.18em]">
            {label}
          </p>
          {loading ? (
            <div className="mt-2 h-6 w-12 animate-pulse rounded bg-muted md:h-7 md:w-16" />
          ) : (
            <p className="mt-1 truncate text-ms-xl font-semibold tabular-nums md:text-ms-2xl">
              {display}
            </p>
          )}
        </div>
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${TONE_CLASS[tone]} md:h-10 md:w-10`}
        >
          <Icon className="h-4 w-4 md:h-[18px] md:w-[18px]" />
        </span>
      </div>
    </div>
  );
}