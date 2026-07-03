import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BOTOL_PER_KARTON } from "@/lib/stock-format";
import { humanBaseUnit } from "@/lib/unit-label";

/**
 * Popover rinci rumus konversi kemasan untuk semua mode (Jual & Pesanan).
 *
 * Mencakup:
 *   - botol ↔ karton  (via BOTOL_PER_KARTON) — hanya untuk package_type='botol'
 *   - 1 kemasan ↔ N base unit (via package_size) — untuk gram/botol/sachet
 *     berukuran > 1 base, dengan label base memakai humanBaseUnit()
 *   - konversi live berdasar qty & mode yang sedang aktif
 *     (`base` / `package` / `karton`)
 *
 * Label unit selalu memakai humanBaseUnit(packageType, baseUnit) sehingga
 * botol-per-pcs (GS-like) tampil "botol", bukan "pcs".
 */
export function KemasanRumusPopover({
  packageType,
  packageSize,
  baseUnit,
  qty,
  mode,
  children,
  testId,
}: {
  packageType: string;
  packageSize: number | null | undefined;
  baseUnit: string;
  qty: number;
  mode: "base" | "package" | "karton";
  children: ReactNode;
  testId?: string;
}) {
  const pt = (packageType ?? "").toLowerCase();
  const ps = Number(packageSize) || 0;
  const humanBase = humanBaseUnit(packageType, baseUnit);
  const isBotol = pt === "botol";
  const per = BOTOL_PER_KARTON;
  const n = Math.max(0, Number(qty) || 0);

  // Konversi live berdasar mode.
  let liveLine: ReactNode = null;
  if (mode === "karton" && isBotol) {
    const botol = n * per;
    liveLine = (
      <>
        <b>{n.toLocaleString("id-ID")}</b> karton × {per} ={" "}
        <b>{botol.toLocaleString("id-ID")}</b> botol
        {ps > 1 ? (
          <>
            {" "}× {ps} = <b>{(botol * ps).toLocaleString("id-ID")}</b>{" "}
            {baseUnit}
          </>
        ) : null}
      </>
    );
  } else if (mode === "package") {
    const base = n * (ps || 1);
    liveLine = (
      <>
        <b>{n.toLocaleString("id-ID")}</b> {packageType}
        {ps > 1 ? (
          <>
            {" "}× {ps} = <b>{base.toLocaleString("id-ID")}</b> {humanBase}
          </>
        ) : null}
        {isBotol ? (
          <>
            {" · "}
            {Math.floor(n / per).toLocaleString("id-ID")} karton
            {n % per > 0 ? ` + ${(n % per).toLocaleString("id-ID")} botol` : ""}
          </>
        ) : null}
      </>
    );
  } else {
    // mode === "base"
    liveLine = (
      <>
        <b>{n.toLocaleString("id-ID")}</b> {humanBase}
        {ps > 1 ? (
          <>
            {" ÷ "}
            {ps} = <b>{(n / ps).toLocaleString("id-ID", { maximumFractionDigits: 2 })}</b>{" "}
            {packageType}
          </>
        ) : null}
        {isBotol && baseUnit === "pcs" ? (
          <>
            {" · "}
            {Math.floor(n / per).toLocaleString("id-ID")} karton
            {n % per > 0 ? ` + ${(n % per).toLocaleString("id-ID")} botol` : ""}
          </>
        ) : null}
      </>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2"
            tabIndex={0}
            data-testid={testId ?? "kemasan-rumus-trigger"}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs whitespace-normal border bg-popover text-popover-foreground shadow-md"
          data-testid="kemasan-rumus-content"
        >
          <div className="space-y-1 text-[11px] leading-relaxed">
            <div className="font-semibold">Rumus konversi kemasan</div>
            {isBotol ? (
              <div>
                1 karton = <b>{per}</b> botol{" "}
                <span className="text-muted-foreground">(BOTOL_PER_KARTON)</span>
              </div>
            ) : null}
            {ps > 1 ? (
              <div>
                1 {packageType} = <b>{ps}</b> {humanBase}{" "}
                <span className="text-muted-foreground">(package_size)</span>
              </div>
            ) : null}
            {!isBotol && ps <= 1 ? (
              <div className="text-muted-foreground">
                Item satuan {packageType} tanpa konversi kemasan.
              </div>
            ) : null}
            <div className="border-t border-border/50 pt-1">
              <div className="text-muted-foreground">Hitungan saat ini:</div>
              <div className="mt-0.5">{liveLine}</div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}