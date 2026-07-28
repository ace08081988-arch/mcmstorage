/**
 * Header sticky khusus mobile (< md) untuk halaman-halaman "aplikasi"
 * (Gudang, Ecer, Tugas, Request, dst.). Struktur:
 *
 *   [← Kembali]  [icon + title / subtitle]              [stat kanan]
 *
 * - Backdrop-blur + border tipis + safe-area-friendly (sticky top-0).
 * - Subtitle disembunyikan di layar < 390px untuk memberi ruang title.
 * - `stat` opsional untuk KPI ringkas (mis. "Nilai stok Rp 12jt").
 *
 * Diekstrak dari /gudang; halaman lain wajib memakai ini agar tidak
 * drift dalam padding, tinggi, atau posisi elemen.
 */
import { Link } from "@tanstack/react-router";
import type { ComponentType, ReactNode } from "react";

export interface PageHeaderStat {
  label: string;
  value: ReactNode;
}

export interface PageHeaderProps {
  /** Ikon kecil di samping title. */
  icon?: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  /** Tautan back-button di kiri. Default: "/" ("← Beranda"). */
  backTo?: string;
  backLabel?: string;
  /** Statistik ringkas rata kanan (mis. { label: "Nilai stok", value: "Rp 12jt" }). */
  stat?: PageHeaderStat;
  /** Node ekstra di bawah baris header (mis. PillsTabs). */
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  backTo = "/",
  backLabel = "← Beranda",
  stat,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={`sticky top-0 z-10 border-b border-primary/15 bg-background/85 backdrop-blur-xl md:hidden ${className ?? ""}`}
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-ms-2 px-ms-4 py-ms-3">
        <div className="flex min-w-0 items-center gap-ms-2">
          <Link
            to={backTo}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-card px-ms-3 text-ms-2xs font-medium text-foreground hover:border-primary/60"
          >
            {backLabel}
          </Link>
          <div className="min-w-0 leading-tight">
            <p className="flex min-w-0 items-center gap-ms-1.5 text-ms-lg text-premium-heading text-foreground">
              {Icon ? <Icon className="h-4 w-4 shrink-0 text-primary" /> : null}
              <span className="truncate">{title}</span>
            </p>
            {subtitle ? (
              <p className="hidden min-[390px]:block truncate text-ms-2xs uppercase tracking-[0.1em] text-primary/70 md:tracking-[0.18em]">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {stat ? (
          <div className="shrink-0 text-right leading-tight">
            <div className="text-ms-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground md:tracking-[0.18em]">
              {stat.label}
            </div>
            <div className="text-ms-sm font-semibold tabular-nums text-foreground">
              {stat.value}
            </div>
          </div>
        ) : null}
      </div>
      {children}
    </header>
  );
}