import { Wallet } from "lucide-react";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { rupiah } from "@/lib/stock-format";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  if (v >= 1_000_000_000)
    return `${sign}Rp ${(v / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (v >= 1_000_000)
    return `${sign}Rp ${(v / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} Jt`;
  if (v >= 1_000)
    return `${sign}Rp ${(v / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb`;
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
    /** Di layar sempit (<=430px) tampilkan ikon saja agar baris chat lega. */
    iconOnlyOnMobile?: boolean;
    interactive?: boolean;
    title?: string;
    "aria-label"?: string;
    className?: string;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function DebtChip(
  {
    tone,
    amount = 0,
    compactOnly = false,
    iconOnlyOnMobile = false,
    interactive = true,
    className = "",
    ...rest
  },
  ref,
) {
  const value = tone === "empty" || tone === "settled" ? 0 : amount;
  const amountRef = useRef<HTMLSpanElement | null>(null);
  const [truncated, setTruncated] = useState(false);

  // Tooltip hanya muncul kalau nominal benar-benar terpotong di layar sempit.
  const measure = useCallback(() => {
    const el = amountRef.current;
    if (!el) return;
    setTruncated(el.scrollWidth - el.clientWidth > 1);
  }, []);

  useEffect(() => {
    measure();
    const el = amountRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [measure, value, tone, compactOnly]);

  const fullText = `${TONE_LABEL[tone]} ${rupiah(value)}`;

  const chip = (
    <button
      ref={ref}
      type="button"
      disabled={!interactive ? true : rest.disabled}
      title={rest.title ?? (truncated ? fullText : undefined)}
      className={`inline-flex h-6 min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 py-0 text-ms-2xs font-semibold leading-none transition ${
        interactive ? "hover:bg-accent" : "cursor-default"
      } ${TONE_CLASS[tone]} ${className}`}
      {...rest}
    >
      <Wallet className="h-3 w-3 shrink-0" />
      <span className={`shrink-0 ${iconOnlyOnMobile ? "hidden min-[431px]:inline" : ""}`}>
        {TONE_LABEL[tone]}
      </span>
      <span
        ref={amountRef}
        className={`min-w-0 truncate font-mono font-normal ${iconOnlyOnMobile ? "hidden min-[431px]:inline" : ""}`}
      >
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

  if (!truncated) return chip;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent side="bottom" className="font-mono text-ms-2xs tabular-nums">
          {fullText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
