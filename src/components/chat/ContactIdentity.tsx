import { Hash, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInviteCode } from "@/lib/invite";
import { formatWaDisplay } from "@/lib/phone";

/**
 * Chip PIN MCM — tampilan seragam di semua permukaan chat
 * (dialog chat baru, tambah kontak, tautkan akun).
 */
export function PinChip({
  code,
  className,
}: {
  code: string | null | undefined;
  className?: string;
}) {
  if (!code) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-1.5",
        "font-mono text-ms-2xs font-medium uppercase leading-none tracking-widest text-primary",
        className,
      )}
      title={`PIN MCM ${formatInviteCode(code)}`}
    >
      <Hash className="h-3 w-3 shrink-0" aria-hidden />
      {formatInviteCode(code)}
    </span>
  );
}

/** Nomor telepon dengan format WA yang konsisten dan aman dipotong. */
export function PhoneText({
  phone,
  className,
  withIcon = true,
}: {
  phone: string | null | undefined;
  className?: string;
  withIcon?: boolean;
}) {
  if (!phone) return null;
  const display = formatWaDisplay(phone) || phone;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-ms-2xs text-muted-foreground",
        className,
      )}
      title={display}
    >
      {withIcon && <Phone className="h-3 w-3 shrink-0" aria-hidden />}
      <span className="truncate font-mono tabular-nums">{display}</span>
    </span>
  );
}