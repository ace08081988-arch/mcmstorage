/**
 * Kartu ringkasan angka (Total Produk / Stok Menipis / dsb.).
 * Diekstrak dari /gudang supaya halaman lain (mis. /ecer, dashboard,
 * riwayat) memakai bentuk & spacing yang sama tanpa drift.
 *
 * API sengaja stabil: props sama persis dengan versi lama di /gudang.
 */
import type { ComponentType } from "react";

export type SummaryTone = "primary" | "warning" | "danger" | "info";

// Tone memakai token semantik (bukan warna literal) supaya mode gelap dan
// high-contrast ikut menyesuaikan lewat override di src/styles.css.
const TONE_CLASS: Record<SummaryTone, string> = {
  primary: "summary-tone summary-tone-primary",
  warning: "summary-tone summary-tone-warning",
  danger: "summary-tone summary-tone-danger",
  info: "summary-tone summary-tone-info",
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
          <p className="summary-card-label truncate text-ms-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:tracking-[0.18em]">
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