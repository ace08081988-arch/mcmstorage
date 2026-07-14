import type React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Re-export biar konsumen cukup import satu file kalau butuh grid pair
// helper (misal untuk membungkus 2 Field bersebelahan di sm:).
export { layoutFieldPairClass } from "@/components/LayoutModeToggle";

/**
 * Ukuran label per konteks:
 *  - "default": text-ms-sm (default Label shadcn) — dialog form utama.
 *  - "xs":      text-ms-xs — dialog padat (mis. PIN, form ecer).
 *  - "compact": text-ms-2xs — kartu / mini dialog.
 *  - "micro":   text-ms-2xs uppercase — chip readonly (Link/PIN).
 *
 * Tujuannya bukan menyeragamkan visual paksa, tapi menghilangkan
 * boilerplate `<div><Label className="…">…</Label>{control}</div>`
 * yang berulang di banyak dialog.
 */
type FieldSize = "default" | "xs" | "compact" | "micro";

const LABEL_CLS: Record<FieldSize, string> = {
  default: "",
  xs: "text-ms-xs",
  compact: "text-ms-2xs",
  micro: "text-ms-2xs uppercase tracking-wide text-muted-foreground",
};

export function Field({
  id,
  htmlFor,
  label,
  size = "default",
  required,
  hint,
  className,
  labelClassName,
  children,
}: {
  /** Anchor id (dipakai DialogScrollProgress `sections`). */
  id?: string;
  /** htmlFor untuk input dengan id yang eksplisit. */
  htmlFor?: string;
  label: React.ReactNode;
  size?: FieldSize;
  required?: boolean;
  /** Teks kecil di bawah input (mis. "= Rp 25.000"). */
  hint?: React.ReactNode;
  className?: string;
  labelClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className={cn(LABEL_CLS[size], labelClassName)}>
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {children}
      {hint ? <div className="text-ms-2xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}