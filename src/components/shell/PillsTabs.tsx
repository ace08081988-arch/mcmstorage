/**
 * Baris pill-tab horizontal-scrollable dengan fade-cue di kiri/kanan
 * (mengisyaratkan konten masih bisa discroll di lebar sempit 411px).
 *
 * Generik atas key (`K extends string`) supaya halaman lain bisa
 * memakai union tab-nya sendiri tanpa kehilangan type-safety.
 *
 * Ekstrak dari /gudang. Halaman lain (mis. Riwayat, Chat) yang punya
 * tab horizontal harus pakai ini agar tidak drift dalam radius,
 * spacing, atau highlight state.
 */
import type { ComponentType } from "react";

export interface PillsTabItem<K extends string> {
  k: K;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

export interface PillsTabsProps<K extends string> {
  tabs: ReadonlyArray<PillsTabItem<K>>;
  value: K;
  onChange: (next: K) => void;
  /** aria-label untuk `<nav role="tablist">`. */
  ariaLabel: string;
  className?: string;
}

export function PillsTabs<K extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
}: PillsTabsProps<K>) {
  return (
    <div className={`relative mx-auto max-w-3xl ${className ?? ""}`}>
      <nav
        role="tablist"
        aria-label={ariaLabel}
        className="flex gap-ms-1.5 overflow-x-auto scroll-smooth px-ms-4 pb-2.5 text-ms-xs [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map(({ k, label, icon: Icon }) => {
          const active = value === k;
          return (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onChange(k)}
              className={`inline-flex shrink-0 items-center gap-ms-2 whitespace-nowrap rounded-full border px-ms-3.5 py-1.5 font-medium tracking-ms-tight transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground elev-sm"
                  : "border-primary/20 bg-card/70 text-foreground/80 hover:border-primary/50 hover:bg-accent"
              }`}
            >
              {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background/95 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background/95 to-transparent"
      />
    </div>
  );
}