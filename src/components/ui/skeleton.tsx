import { cn } from "@/lib/utils";

/**
 * Placeholder muat data yang ramah aksesibilitas:
 * - kontras memakai token `muted-foreground` (bukan primary/10 yang samar),
 * - denyut otomatis mati saat pengguna memilih "kurangi animasi",
 * - diumumkan sebagai status sopan bagi pembaca layar.
 */
function Skeleton({
  className,
  label = "Memuat…",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
      className={cn("skeleton-a11y rounded-md", className)}
      {...props}
    />
  );
}

export { Skeleton };
