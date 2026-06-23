import { useState } from "react";
import { toast } from "sonner";
import { Copy, MessageCircle, X, KeyRound } from "lucide-react";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";

/**
 * Dialog kecil untuk membagikan link tugas + PIN dalam satu pesan.
 *
 * PIN disimpan di server sebagai hash bcrypt sehingga tidak bisa diambil
 * kembali. Pemilik mengetik PIN sekali di sini hanya untuk dibagikan —
 * tidak disimpan di mana pun di klien.
 */
export function SharePinDialog({
  title,
  url,
  onClose,
}: {
  title: string;
  url: string;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const message = [
    `Halo, tolong siapkan barang berikut:`,
    ``,
    title,
    `Link: ${url}`,
    pin ? `PIN: ${pin}` : `PIN: (isi PIN-nya)`,
    ``,
    `Buka link → masukkan PIN → foto barangnya & kirim.`,
  ].join("\n");

  async function copyAll() {
    if (!pin) return toast.error("Isi PIN dulu");
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Pesan & PIN disalin");
    } catch {
      toast.error("Gagal menyalin");
    }
  }

  async function shareWa() {
    if (!pin) return toast.error("Isi PIN dulu");
    setBusy(true);
    const res = await shareToWhatsApp({ text: message, title, url });
    notifyShareResult(res);
    setBusy(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl border bg-card p-4 shadow-lg sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Bagikan link + PIN</div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <div className="mb-1 text-[11px] text-muted-foreground">Tugas</div>
            <div className="truncate rounded-md border bg-muted/40 px-2 py-1.5 text-sm">{title}</div>
          </div>

          <div>
            <div className="mb-1 text-[11px] text-muted-foreground">Link pegawai</div>
            <div className="truncate rounded-md border bg-muted/40 px-2 py-1.5 text-xs font-mono">{url}</div>
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <KeyRound className="h-3 w-3" /> PIN tugas (4–8 digit)
            </label>
            <input
              autoFocus
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="••••"
              className="h-11 w-full rounded-md border bg-background px-3 text-center text-xl tracking-[0.4em] tabular-nums"
            />
            <div className="mt-1 text-[10px] text-muted-foreground">
              PIN tidak disimpan ulang — hanya disertakan dalam pesan yang Anda kirim. Lupa PIN? Pakai menu "Link pegawai" untuk reset.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void copyAll()}
              disabled={busy}
              className="inline-flex h-10 items-center justify-center gap-1 rounded-md border px-3 text-sm"
            >
              <Copy className="h-4 w-4" /> Salin
            </button>
            <button
              type="button"
              onClick={() => void shareWa()}
              disabled={busy || !pin}
              className="inline-flex h-10 items-center justify-center gap-1 rounded-md bg-[#25D366] px-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              <MessageCircle className="h-4 w-4" /> Kirim WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}