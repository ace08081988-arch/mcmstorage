import { toast } from "sonner";
import {
  getCallStatusVisual,
  type CallVisualStatus,
} from "@/lib/call-status-visual";

/**
 * Tombol inline status panggilan pada baris riwayat /panggilan.
 *
 * - Menampilkan ikon + label warna dari `getCallStatusVisual`.
 * - `title` + `aria-label` = deskripsi panjang (`hint`) → berfungsi sebagai
 *   tooltip native saat pointer hover / focus.
 * - Klik → `toast.info(hint)` supaya pengguna sentuh (mobile) tetap bisa
 *   membaca konteks status tanpa hover.
 *
 * Diekstraksi ke komponen mandiri agar bisa diuji secara end-to-end
 * (lihat `tests/integration/call-status-button.test.ts`).
 */
export function CallStatusButton({
  status,
  outgoing,
  overrideLabel,
  trailing,
}: {
  status: CallVisualStatus;
  outgoing: boolean;
  /** Ganti label default (mis. durasi panggilan untuk status "ended"). */
  overrideLabel?: string;
  /** Node tambahan setelah label (mis. separator + waktu). */
  trailing?: React.ReactNode;
}) {
  const visual = getCallStatusVisual(status, { outgoing });
  const { Icon, colorClass, hint } = visual;
  const label = overrideLabel ?? visual.label;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toast.info(hint);
      }}
      title={hint}
      aria-label={hint}
      data-testid={`call-status-${status}`}
      className="flex items-center gap-ms-1 text-ms-2xs text-muted-foreground hover:underline"
    >
      <Icon className={`h-3 w-3 ${colorClass}`} />
      <span className={colorClass}>{label}</span>
      {trailing}
    </button>
  );
}