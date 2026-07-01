import { useEffect, useMemo, useState } from "react";
import { Plus, ScanLine, Loader2, UserPlus, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrScannerDialog } from "@/components/QrScannerDialog";
import {
  addContactByInviteCode,
  formatInviteCode,
  isLikelyInviteCode,
  normalizeInviteCode,
  resolveInviteCode,
  type InviteProfile,
} from "@/lib/invite";

/**
 * Floating action button (+) di pojok kanan bawah daftar chat.
 *
 * Dialog "Tambah kontak" menerima PIN MCM 8-karakter atau URL undangan
 * `/i/<code>`. Sumber PIN bisa diketik manual atau dipindai dari QR
 * via `QrScannerDialog` (menggunakan kamera perangkat — sama seperti
 * halaman /undang).
 *
 * Aksi:
 *  - "Kirim permintaan" → `addContactByInviteCode` (RPC send_friend_request).
 *    Server akan menandai `pending` bila belum berteman, atau mengembalikan
 *    `alreadyFriends`/`alreadyExisted` bila sudah.
 *
 * Semua feedback lewat toast (short) + inline preview supaya user melihat
 * nama tujuan sebelum mengirim.
 */
export function AddContactFab() {
  const [open, setOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<InviteProfile | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const cleaned = normalizeInviteCode(input);
  const looksValid = isLikelyInviteCode(input);

  // Reset state saat dialog dibuka ulang.
  useEffect(() => {
    if (!open) {
      setInput("");
      setPreview(null);
      setChecking(false);
      setSubmitting(false);
    }
  }, [open]);

  // Debounced preview resolve — mirip alur di /undang.
  useEffect(() => {
    let cancelled = false;
    if (!looksValid) {
      setPreview(null);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const p = await resolveInviteCode(cleaned);
        if (!cancelled) setPreview(p);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [cleaned, looksValid]);

  const canSubmit = useMemo(
    () => looksValid && !submitting && !checking,
    [looksValid, submitting, checking],
  );

  async function onSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const r = await addContactByInviteCode(cleaned);
      if (r.alreadyFriends) {
        toast.success("Sudah berteman — kontak siap dipakai.");
      } else if (r.pending) {
        toast.success("Permintaan terkirim. Menunggu diterima.");
      } else if (r.alreadyExisted) {
        toast.success("Kontak sudah tersimpan.");
      } else {
        toast.success("Kontak ditambahkan.");
      }
      setOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gagal menambah kontak.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Tambah kontak PIN MCM"
        className="fixed bottom-6 right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-95"
      >
        <Plus className="h-6 w-6" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Tambah kontak PIN
            </DialogTitle>
            <DialogDescription>
              Masukkan PIN MCM 8-karakter atau pindai QR undangan teman.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="fab-pin-input" className="text-xs">
                PIN MCM
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="fab-pin-input"
                  autoFocus
                  inputMode="text"
                  autoCapitalize="characters"
                  placeholder="XXXX-XXXX"
                  value={input}
                  onChange={(e) => {
                    // Format-as-you-type (uppercase + dash setelah 4 char).
                    const raw = normalizeInviteCode(e.target.value);
                    setInput(raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}` : raw);
                  }}
                  className="font-mono tracking-widest"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Pindai QR undangan"
                  onClick={() => setScanOpen(true)}
                >
                  <ScanLine className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Format: 8 karakter huruf/angka. Contoh: <code>ABCD-1234</code>.
              </p>
            </div>

            {/* Preview target */}
            <div className="rounded-lg border p-3 text-sm">
              {!looksValid ? (
                <p className="text-xs text-muted-foreground">
                  Ketik PIN atau pindai QR untuk melihat pratinjau.
                </p>
              ) : checking ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memeriksa PIN…
                </p>
              ) : preview ? (
                <div className="flex items-center gap-3">
                  {preview.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preview.avatar_url}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-primary">
                      <UserPlus className="h-4 w-4" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {preview.display_name || "Pengguna MCM"}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      PIN {formatInviteCode(preview.invite_code)}
                    </div>
                  </div>
                  <Check className="h-4 w-4 text-emerald-600" aria-hidden />
                </div>
              ) : (
                <p className="text-xs text-amber-600">
                  PIN tidak ditemukan. Periksa lagi kode yang diberikan teman.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              <X className="mr-1 h-4 w-4" /> Batal
            </Button>
            <Button type="button" onClick={onSubmit} disabled={!canSubmit}>
              {submitting ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-1 h-4 w-4" />
              )}
              Kirim permintaan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QrScannerDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Pindai QR undangan"
        description="Arahkan kamera ke QR undangan teman untuk mengisi PIN otomatis."
        onResult={(text) => {
          // Terima URL undangan same-origin (`/i/<code>`) atau PIN mentah.
          const trimmed = (text ?? "").trim();
          try {
            const u = new URL(trimmed);
            const m = u.pathname.match(/\/i\/([^/?#]+)/);
            if (m) {
              const code = normalizeInviteCode(decodeURIComponent(m[1]));
              if (isLikelyInviteCode(code)) {
                setInput(formatInviteCode(code));
                toast.success("PIN terisi dari QR.");
                return;
              }
            }
          } catch {
            /* not a URL */
          }
          if (isLikelyInviteCode(trimmed)) {
            setInput(formatInviteCode(normalizeInviteCode(trimmed)));
            toast.success("PIN terisi dari QR.");
            return;
          }
          toast.error("QR bukan undangan MCM yang dikenali.");
        }}
      />
    </>
  );
}