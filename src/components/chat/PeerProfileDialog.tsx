import { Pencil, BookUser, Phone, X, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatInviteCode } from "@/lib/invite";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  peerUserId: string | null;
  displayName: string;
  /**
   * Nomor telepon peer. Hanya diteruskan dari parent bila RPC
   * `get_chat_member_profiles` mengembalikannya (yaitu peer sudah ada di
   * address_book pemanggil, atau melihat profil sendiri). Bila null,
   * baris nomor telepon tidak dirender.
   */
  peerPhone?: string | null;
  /** PIN undangan peer (aman ditampilkan; digunakan untuk menambah kontak). */
  peerInviteCode?: string | null;
  onEditName?: () => void;
  onOpenAddressBook?: () => void;
};

function initialOf(name: string): string {
  const s = name.trim();
  return s ? s[0]!.toUpperCase() : "?";
}

export function PeerProfileDialog({
  open,
  onOpenChange,
  peerUserId,
  displayName,
  peerPhone,
  peerInviteCode,
  onEditName,
  onOpenAddressBook,
}: Props) {
  // Semua data profil peer HARUS diteruskan dari parent yang sudah lewat
  // RPC `get_chat_member_profiles` (yang menyaring email dan meng-gate
  // phone berdasarkan address_book pemanggil). Dialog TIDAK memfetch
  // profiles secara langsung — RLS profiles hanya mengizinkan owner
  // membaca barisnya sendiri, jadi query cross-user selalu kembali null.
  const invite = useMemo(
    () => (peerInviteCode ? formatInviteCode(peerInviteCode) : null),
    [peerInviteCode],
  );
  const trimmedPhone = (peerPhone ?? "").trim();
  const [phoneCopied, setPhoneCopied] = useState(false);
  const copyPhone = async () => {
    if (!trimmedPhone) return;
    try {
      await navigator.clipboard.writeText(trimmedPhone);
      setPhoneCopied(true);
      window.setTimeout(() => setPhoneCopied(false), 1500);
    } catch {
      /* clipboard tidak tersedia — abaikan senyap */
    }
  };
  // Untuk debugging visual saat dialog dibuka tanpa peer.
  void peerUserId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Profil {displayName}</DialogTitle>
          <DialogDescription>Detail kontak percakapan</DialogDescription>
        </DialogHeader>

        {/* Avatar besar — hanya inisial. Avatar asli tidak dapat dibaca
            lintas pengguna karena RLS profiles hanya untuk owner. */}
        <div className="relative bg-[var(--wa-surface-2,theme(colors.muted.DEFAULT))]">
          <button
            type="button"
            aria-label="Tutup"
            onClick={() => onOpenChange(false)}
            className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="grid aspect-square w-full place-items-center bg-orange-950 text-6xl font-semibold text-orange-300">
            {initialOf(displayName)}
          </div>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold">{displayName}</div>
              {invite ? (
                <div className="font-mono text-xs tabular-nums tracking-widest text-muted-foreground">
                  PIN {invite}
                </div>
              ) : null}
            </div>
            {onEditName ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit nama kontak"
                onClick={() => {
                  onOpenChange(false);
                  onEditName();
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            ) : null}
          </div>

          {trimmedPhone ? (
            <div className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/40 px-3 py-2">
              <Phone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Nomor telepon
                </div>
                <div className="truncate font-mono text-sm tabular-nums" data-testid="peer-profile-phone">
                  {trimmedPhone}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={phoneCopied ? "Nomor tersalin" : "Salin nomor"}
                onClick={copyPhone}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            {onOpenAddressBook ? (
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => {
                  onOpenChange(false);
                  onOpenAddressBook();
                }}
              >
                <BookUser className="mr-2 h-4 w-4" />
                Simpan ke buku alamat
              </Button>
            ) : null}
          </div>

          {/* Catatan privasi: field seperti email, tanggal lahir, alamat,
              status "terakhir dilihat" mentah, dsb. TIDAK ditampilkan di
              sini. Kontrak ini di-enforce di RPC get_chat_member_profiles
              dan diuji di supabase/tests/security_rls_authz.sql blok 16 &
              17 serta tests/integration/chat-member-profiles-privacy.test.ts. */}
        </div>
      </DialogContent>
    </Dialog>
  );
}
