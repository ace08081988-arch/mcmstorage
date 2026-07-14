import { cn } from "@/lib/utils";
import {
  STATUS_LABEL_ID,
  STATUS_VARIANT,
  type LifecycleStatus,
} from "@/lib/prep-status";

/**
 * Konsisten status badge untuk semua varian pesanan/produk.
 * - Tinggi tetap, leading-none, whitespace-nowrap, max-w-full + truncate
 *   agar tidak overflow di breakpoint sempit (≤360px).
 * - Mengandalkan token semantik (bg-muted, text-muted-foreground) +
 *   aksen warna konsisten (amber/emerald/sky/destructive).
 */
export type StatusVariant =
  | "menunggu"
  | "siap"
  | "selesai"
  | "hutang"
  | "lunas"
  | "kelebihan"
  | "info"
  | "danger";

function variantClass(v: StatusVariant): string {
  switch (v) {
    case "menunggu":
    case "hutang":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "siap":
    case "lunas":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "kelebihan":
    case "info":
      return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
    case "danger":
      return "bg-destructive/15 text-destructive";
    case "selesai":
    default:
      return "bg-muted text-muted-foreground";
  }
}

function resolveVariant(status: string): StatusVariant {
  const s = status.toLowerCase();
  if (s === "menunggu" || s === "hutang") return s as StatusVariant;
  if (s === "siap" || s === "lunas") return s as StatusVariant;
  if (s === "kelebihan") return "kelebihan";
  if (s === "selesai") return "selesai";
  return "info";
}

export function StatusBadge({
  status,
  variant,
  lifecycle,
  size = "sm",
  className,
  children,
}: {
  status?: string;
  variant?: StatusVariant;
  lifecycle?: LifecycleStatus;
  size?: "xs" | "sm";
  className?: string;
  children?: React.ReactNode;
}) {
  // `lifecycle` menang atas `status`/`variant` — SSOT untuk pipeline pesanan.
  const v = lifecycle
    ? STATUS_VARIANT[lifecycle]
    : (variant ?? resolveVariant(status ?? ""));
  const label =
    children ?? (lifecycle ? STATUS_LABEL_ID[lifecycle] : (status ?? ""));
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded font-semibold uppercase leading-none",
        "max-w-full whitespace-nowrap tracking-wide",
        size === "xs" ? "h-5 px-1.5 text-ms-2xs" : "h-6 px-ms-2 text-ms-2xs",
        variantClass(v),
        className,
      )}
      title={typeof label === "string" ? label : undefined}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
