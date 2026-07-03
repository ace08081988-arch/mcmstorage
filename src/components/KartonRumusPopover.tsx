import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BOTOL_PER_KARTON } from "@/lib/stock-format";

/**
 * Popover/tooltip yang merinci rumus konversi botol → karton.
 *
 * Muncul ketika pengguna hover / focus pada label stok atau badge
 * konversi karton. Menampilkan:
 *   - konstanta BOTOL_PER_KARTON
 *   - package_size item (bila > 1) sebagai konversi base ↔ botol
 *   - hasil perhitungan untuk N botol saat ini (karton bulat + sisa botol)
 */
export function KartonRumusPopover({
  botol,
  packageSize,
  children,
  testId,
}: {
  botol: number;
  packageSize?: number | null;
  children: ReactNode;
  testId?: string;
}) {
  const n = Math.max(0, Math.round(Number(botol) || 0));
  const per = BOTOL_PER_KARTON;
  const kInt = Math.floor(n / per);
  const sisa = n - kInt * per;
  const ps = Number(packageSize) || 0;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2"
            tabIndex={0}
            data-testid={testId ?? "karton-rumus-trigger"}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs whitespace-normal bg-popover text-popover-foreground border shadow-md"
          data-testid="karton-rumus-content"
        >
          <div className="space-y-1 text-[11px] leading-relaxed">
            <div className="font-semibold">Rumus konversi karton</div>
            <div>
              1 karton = <b>{per}</b> botol{" "}
              <span className="text-muted-foreground">(BOTOL_PER_KARTON)</span>
            </div>
            {ps > 1 ? (
              <div>
                1 botol = <b>{ps}</b> pcs{" "}
                <span className="text-muted-foreground">(package_size)</span>
              </div>
            ) : null}
            <div className="pt-1 border-t border-border/50">
              <div>
                N botol ÷ {per} = karton
              </div>
              <div className="mt-0.5">
                <b>{n.toLocaleString("id-ID")}</b> ÷ {per} ={" "}
                <b>{kInt.toLocaleString("id-ID")}</b> karton
                {sisa > 0 ? (
                  <>
                    {" "}+ <b>{sisa.toLocaleString("id-ID")}</b> botol sisa
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}