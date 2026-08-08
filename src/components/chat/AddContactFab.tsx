import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, ScanLine, Loader2, UserPlus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useStartDm } from "@/lib/chat";
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
  validateInviteCode,
  type InviteProfile,
} from "@/lib/invite";
import { PinChip } from "@/components/chat/ContactIdentity";

/**
 * Floating action button (+) di pojok kanan bawah daftar chat.
 *
 * Dialog "Tambah kontak" menerima PIN Ace 8-karakter atau URL undangan
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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const startDm = useStartDm();

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

  // L13: sequence id — response request lama tidak boleh menimpa preview
  // terbaru saat user mengetik cepat.
  const reqIdRef = useRef(0);

  // Debounced preview resolve — mirip alur di /undang.
  useEffect(() => {
    let cancelled = false;
    const myReq = ++reqIdRef.current;
    if (!looksValid) {
      setPreview(null);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const p = await resolveInviteCode(cleaned);
        if (!cancelled && myReq === reqIdRef.current) setPreview(p);
      } catch {
        if (!cancelled && myReq === reqIdRef.current) setPreview(null);
      } finally {
        if (!cancelled && myReq === reqIdRef.current) setChecking(false);
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
    const v = validateInviteCode(input);
    if (!v.ok) {
      toast.error(v.reason);
      return;
    }
    setSubmitting(true);
    try {
      const r = await addContactByInviteCode(v.code);
      // Selalu segarkan daftar permintaan pertemanan supaya baris baru
      // muncul langsung di tab Terkirim / Masuk sesuai konteks.
      qc.invalidateQueries({ queryKey: ["friend-requests"] });
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      setOpen(false);

      if (r.alreadyFriends) {
        // Sudah berteman → buka DM langsung, bukan hanya tampilkan toast.
        toast.success(`Sudah berteman dengan ${r.displayName ?? "kontak"}. Membuka chat…`);
        try {
          const cid = await startDm.mutateAsync(r.linkedUserId);
          if (cid) {
            navigate({ to: "/chat/$conversationId", params: { conversationId: cid } });
            return;
          }
          navigate({ to: "/chat" });
        } catch (e) {
          console.error("[AddContactFab] start_dm failed", e);
          navigate({ to: "/chat" });
        }
        return;
      }

      if (r.incomingReverseId) {
        // Lawan sudah kirim permintaan lebih dulu → arahkan ke halaman
        // permintaan supaya user bisa menekan Terima (bukan kirim balik).
        toast.info(
          `${r.displayName ?? "Kontak"} sudah mengirim permintaan lebih dulu — buka daftar Permintaan untuk menerima.`,
        );
        navigate({ to: "/kontak/permintaan" as never });
        return;
      }

      // Permintaan baru dikirim atau sudah ada dalam status pending.
      toast.success(
        r.alreadyExisted
          ? `Permintaan sebelumnya masih menunggu diterima ${r.displayName ?? "kontak"}.`
          : `Permintaan pertemanan terkirim ke ${r.displayName ?? "kontak"}.`,
      );
      navigate({ to: "/kontak/permintaan" as never });
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
        aria-label="Tambah kontak PIN Ace"
        // Ukuran 44px di layar kecil (memenuhi tap-target minimum tanpa
        // menutupi label "Pembaruan"/"Panggilan" pada 360-390px), 48px
        // mulai 400px. Posisi bottom = tinggi nav (`--chat-nav-h`, sudah
        // termasuk safe-area-inset-bottom) + gap konstan 0.75rem — jadi
        // FAB selalu duduk rapi di atas nav tanpa menghitung safe-area
        // dua kali. Fallback menambahkan safe-area agar tetap aman bila
        // container tidak menyetel variabelnya.
        className="fixed app-fab-right z-[var(--z-fab)] grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/25 transition active:scale-95 min-[400px]:h-12 min-[400px]:w-12"
        style={{
          bottom:
            "calc(max(var(--chat-nav-h, 0px), var(--app-bottom-bar-space, 0px), var(--app-safe-bottom, env(safe-area-inset-bottom, 0px))) + 0.75rem)",
        }}
      >
        <Plus className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="chat-field-scope max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-ms-2">
              <UserPlus className="h-4 w-4" /> Tambah kontak PIN
            </DialogTitle>
            <DialogDescription>
              Masukkan PIN Ace 8-karakter atau pindai QR undangan teman.
            </DialogDescription>
          </DialogHeader>

          <div className="space-ms-3">
            <div className="space-y-1.5">
              <Label htmlFor="fab-pin-input" className="text-ms-xs">
                PIN Ace
              </Label>
              <div className="flex items-center gap-ms-2">
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
              <p className="text-ms-2xs text-muted-foreground">
                Format: 8 karakter huruf/angka. Contoh: <code>ABCD-1234</code>.
              </p>
            </div>

            {/* Preview target */}
            <div className="rounded-lg border p-ms-3 text-ms-sm">
              {!looksValid ? (
                <p className="text-ms-xs text-muted-foreground">
                  Ketik PIN atau pindai QR untuk melihat pratinjau.
                </p>
              ) : checking ? (
                <p className="flex items-center gap-ms-2 text-ms-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memeriksa PIN…
                </p>
              ) : preview ? (
                <div className="flex items-center gap-ms-3">
                  {preview.avatar_url ? (
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
                      {preview.display_name || "Pengguna Ace"}
                    </div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-ms-2">
                      <PinChip code={preview.invite_code} />
                    </div>
                  </div>
                  <Check className="h-4 w-4 text-success" aria-hidden />
                </div>
              ) : (
                <p className="text-ms-xs text-warning">
                  PIN tidak ditemukan. Periksa lagi kode yang diberikan teman.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-ms-2 sm:justify-end">
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
          toast.error("QR bukan undangan Ace yang dikenali.");
        }}
      />
    </>
  );
}
