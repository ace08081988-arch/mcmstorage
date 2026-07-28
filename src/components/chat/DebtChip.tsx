import { Wallet } from "lucide-react";
import { forwardRef } from "react";
import { rupiah } from "@/lib/stock-format";

/**
 * Chip catatan hutang/piutang — SSOT tampilan.
 *
 * Dipakai di daftar chat, pratinjau kartu, dan header percakapan agar
 * bentuk, warna, dan wording persis sama di semua lokasi. Chip SELALU
 * dirender: saat belum ada catatan pun tampil netral "Catatan Rp 0".
 */
export type DebtChipTone = "empty" | "settled" | "piutang" | "hutang";

export function debtChipTone(hutang: number, piutang: number, linked: boolean): DebtChipTone {
  if (!linked) return "empty";
  if (hutang <= 0 && piutang <= 0) return "settled";
  return piutang >= hutang ? "piutang" : "hutang";
}

/** Format rupiah ringkas agar nominal tetap terbaca di layar sempit. */
export function rupiahCompact(n: number): string {
  const v = Math.abs(n || 0);
  const sign = n < 0 ? "-" : "";
  if (v >= 1_000_000_000) return `${sign}Rp ${(v / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (v >= 1_000_000) return `${sign}Rp ${(v / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} Jt`;
  if (v >= 1_000) return `${sign}Rp ${(v / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb`;
  return rupiah(n);
}

const TONE_CLASS: Record<DebtChipTone, string> = {
  empty: "border-border bg-muted/40 text-muted-foreground",
  settled: "border-success/40 bg-success/10 text-success",
  piutang: "border-success/40 bg-success/10 text-success",
  hutang: "border-warning/40 bg-warning/10 text-warning",
};

const TONE_LABEL: Record<DebtChipTone, string> = {
  empty: "Catatan",
  settled: "Lunas",
  piutang: "Piutang",
  hutang: "Hutang",
};

export const DebtChip = forwardRef<
  HTMLButtonElement,
  {
    tone: DebtChipTone;
    /** Nominal sisa; diabaikan saat tone "settled"/"empty" (selalu Rp 0). */
    amount?: number;
    /** Selalu tampilkan nominal penuh (tanpa versi ringkas). */
    compactOnly?: boolean;
    interactive?: boolean;
    title?: string;
    "aria-label"?: string;
    className?: string;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function DebtChip(
  { tone, amount = 0, compactOnly = false, interactive = true, className = "", ...rest },
  ref,
) {
  const value = tone === "empty" || tone === "settled" ? 0 : amount;
  return (
    <button
      ref={ref}
      type="button"
      disabled={!interactive ? true : rest.disabled}
      className={`inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 py-0.5 text-ms-2xs font-semibold leading-tight transition ${
        interactive ? "hover:bg-accent" : "cursor-default"
      } ${TONE_CLASS[tone]} ${className}`}
      {...rest}
    >
      <Wallet className="h-3 w-3 shrink-0" />
      <span className="shrink-0">{TONE_LABEL[tone]}</span>
      <span className="min-w-0 truncate font-mono font-normal">
        {compactOnly ? (
          rupiahCompact(value)
        ) : (
          <>
            <span className="sm:hidden">{rupiahCompact(value)}</span>
            <span className="hidden sm:inline">{rupiah(value)}</span>
          </>
        )}
      </span>
    </button>
  );
});
