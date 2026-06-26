import { useState } from "react";
import { toast } from "sonner";
import { useEffect, useRef } from "react";
import { Copy, MessageCircle, X, KeyRound, Eye, EyeOff } from "lucide-react";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { supabase } from "@/integrations/supabase/client";
import { TaskQrCode } from "@/components/TaskQrCode";

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
  taskId,
  shareToken,
  onClose,
}: {
  title: string;
  url: string;
  taskId?: string;
  shareToken?: string;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedPin, setSavedPin] = useState("");
  // PIN dimask secara default. Setelah pemilik mengetik PIN ≥ 4 digit,
  // tombol "Tampilkan" akan membuka PIN selama beberapa detik lalu
  // otomatis kembali tersembunyi — aman tapi mudah dicek sebelum kirim.
  const [reveal, setReveal] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<number | null>(null);
  const REVEAL_SECONDS = 5;

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  function startReveal() {
    if (pin.length < 4) {
      toast.error("Isi PIN minimal 4 digit dulu");
      return;
    }
    setReveal(true);
    setSecondsLeft(REVEAL_SECONDS);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          timerRef.current = null;
          setReveal(false);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  const maskedPin = pin ? "•".repeat(pin.length) : "";
  const displayPin = reveal ? pin : maskedPin;

  const message = [
    `Halo, tolong siapkan barang berikut:`,
    ``,
    title,
    `Link: ${url}`,
    pin ? `PIN: ${pin}` : `PIN: (isi PIN-nya)`,
    ``,
    `Buka link → masukkan PIN → foto barangnya & kirim.`,
  ].join("\n");

  async function ensurePinActive() {
    if (!/^\d{4,8}$/.test(pin)) {
      toast.error("PIN harus 4–8 digit angka");
      return false;
    }
    if (!taskId || savedPin === pin) return true;

    const { error } = await supabase.rpc("prep_reset_pin", { _task_id: taskId, _pin: pin });
    if (error) {
      toast.error("Gagal mengaktifkan PIN baru: " + error.message);
      return false;
    }

    if (shareToken) {
      // Bersihkan lock/percobaan salah lama supaya pegawai bisa langsung mencoba PIN baru.
      await (supabase.rpc as any)("prep_pin_reset", { _token: shareToken });
    }

    setSavedPin(pin);
    toast.success("PIN baru aktif untuk tugas ini");
    return true;
  }

  async function copyAll() {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await ensurePinActive())) return;
      await navigator.clipboard.writeText(message);
      toast.success("Pesan & PIN disalin");
    } catch {
      toast.error("Gagal menyalin");
    } finally {
      setBusy(false);
    }
  }

  async function shareWa() {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await ensurePinActive())) return;
      const res = await shareToWhatsApp({ text: message, title, url });
      notifyShareResult(res);
      onClose();
    } finally {
      setBusy(false);
    }
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

          <TaskQrCode url={url} pin={pin || undefined} title={title} />

          <div>
            <label className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <KeyRound className="h-3 w-3" /> PIN tugas (4–8 digit)
            </label>
            <div className="relative">
              <input
                autoFocus
                inputMode="numeric"
                type={reveal ? "text" : "password"}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="••••"
                className="h-11 w-full rounded-md border bg-background px-3 pr-20 text-center text-xl tracking-[0.4em] tabular-nums"
              />
              <button
                type="button"
                onClick={() => (reveal ? setReveal(false) : startReveal())}
                className="absolute right-1 top-1/2 inline-flex h-9 -translate-y-1/2 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted"
                aria-label={reveal ? "Sembunyikan PIN" : "Tampilkan PIN"}
              >
                {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {reveal ? `${secondsLeft}d` : "Lihat"}
              </button>
            </div>
            {pin && (
              <div className="mt-1 flex items-center justify-between text-[10px]">
                <span className="font-mono tracking-[0.3em] text-muted-foreground">
                  {displayPin}
                </span>
                {reveal && (
                  <span className="text-amber-600 dark:text-amber-400">
                    Tersembunyi otomatis dalam {secondsLeft} detik
                  </span>
                )}
              </div>
            )}
            <div className="mt-1 text-[10px] text-muted-foreground">
              PIN dimask demi keamanan. Tekan "Lihat" untuk memeriksa sebentar sebelum dikirim. {taskId ? "Saat disalin/dikirim, PIN ini diaktifkan untuk tugas dan percobaan salah pegawai direset." : "PIN tidak disimpan ulang — hanya disertakan dalam pesan yang Anda kirim."}
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