/**
 * Primitive SSOT untuk tombol Kirim WA & Kirim Chat di semua alur
 * penjualan (/tugas Siapkan Sendiri, /ecer Ready, ReadyPackagesPanel).
 *
 * Kontrak (jangan diubah tanpa memutakhirkan semua callsite tombol
 * share penjualan):
 *   • Warna WA WAJIB `#25D366` (solid) atau `#25D366/10 + #1ea952`
 *     (soft). Warna Chat WAJIB token `primary`. Class hex hard-coded
 *     di luar file ini dianggap regresi.
 *   • Ukuran `sm` = h-7 text-ms-2xs; `md` = h-9 text-ms-xs. Tidak ada
 *     ukuran custom lain untuk tombol share penjualan.
 *   • Label: `sm` = "WA"/"Chat"; `md` = "Kirim WA"/"Kirim Chat".
 *   • `disabled` + `reason` → tooltip = reason, cursor not-allowed,
 *     opacity 50, dan `aria-disabled="true"`.
 *   • Icon Lucide `Send` (WA) / `MessageCircle` (Chat). Saat `busy`,
 *     icon diganti `Loader2` spin. Tidak ada emoji di label.
 */
import { forwardRef } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";

export type ShareBtnSize = "sm" | "md";
export type ShareBtnVariant = "soft" | "solid";

type BaseProps = {
  size?: ShareBtnSize;
  variant?: ShareBtnVariant;
  disabled?: boolean;
  reason?: string | null;
  busy?: boolean;
  onClick?: () => void;
  className?: string;
  /**
   * Pengganti label default; dipakai bila surface butuh label khusus
   * (mis. jumlah kotak). Biarkan `undefined` untuk pakai label kontrak.
   */
  label?: string;
  "data-testid"?: string;
};

const SIZE_CLS: Record<ShareBtnSize, string> = {
  sm: "h-7 px-ms-2 text-ms-2xs",
  md: "h-9 px-ms-3 text-ms-xs",
};

const ICON_SIZE: Record<ShareBtnSize, string> = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
};

const WA_CLS: Record<ShareBtnVariant, string> = {
  solid:
    "bg-wa text-white shadow-sm hover:bg-wa/90 disabled:hover:bg-wa",
  soft:
    "border border-wa/40 bg-wa/10 text-wa-strong hover:bg-wa/20",
};

const CHAT_CLS: Record<ShareBtnVariant, string> = {
  solid:
    "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:hover:bg-primary",
  soft:
    "border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
};

function baseCls(size: ShareBtnSize) {
  return `inline-flex items-center justify-center gap-ms-1 rounded-md font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLS[size]}`;
}

export const WaShareButton = forwardRef<HTMLButtonElement, BaseProps>(
  function WaShareButton(
    { size = "sm", variant = "soft", disabled, reason, busy, onClick, className, label, ...rest },
    ref,
  ) {
    const isDisabled = !!disabled || !!busy;
    const defaultLabel = size === "md" ? "Kirim WA" : "WA";
    const title = isDisabled && reason ? reason : "Kirim foto + rincian penjualan ke pembeli via WhatsApp";
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        aria-label="Kirim ke WhatsApp"
        title={title}
        data-testid={rest["data-testid"] ?? "share-wa-btn"}
        className={`${baseCls(size)} ${WA_CLS[variant]} ${className ?? ""}`}
      >
        {busy ? (
          <Loader2 className={`${ICON_SIZE[size]} animate-spin`} aria-hidden />
        ) : (
          <Send className={ICON_SIZE[size]} aria-hidden />
        )}
        {label ?? defaultLabel}
      </button>
    );
  },
);

export const ChatShareButton = forwardRef<HTMLButtonElement, BaseProps>(
  function ChatShareButton(
    { size = "sm", variant = "soft", disabled, reason, busy, onClick, className, label, ...rest },
    ref,
  ) {
    const isDisabled = !!disabled || !!busy;
    const defaultLabel = size === "md" ? "Kirim Chat" : "Chat";
    const title = isDisabled && reason ? reason : "Kirim foto + rincian penjualan ke pembeli via MCM Chat";
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        aria-label="Kirim ke MCM Chat"
        title={title}
        data-testid={rest["data-testid"] ?? "share-chat-btn"}
        className={`${baseCls(size)} ${CHAT_CLS[variant]} ${className ?? ""}`}
      >
        {busy ? (
          <Loader2 className={`${ICON_SIZE[size]} animate-spin`} aria-hidden />
        ) : (
          <MessageCircle className={ICON_SIZE[size]} aria-hidden />
        )}
        {label ?? defaultLabel}
      </button>
    );
  },
);