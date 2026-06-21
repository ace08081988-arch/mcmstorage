import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, MessageSquarePlus, Search, UserRound, Link2, ArrowRight, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useChatContacts, useStartDm } from "@/lib/chat";
import { buildWhatsAppUrl } from "@/lib/share-wa";

// Normalisasi nomor → digit-only (tanpa "+"). 0xxx → 62xxx, 00xxx → xxx.
function normalizeWaDigits(raw: string): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "62" + d.slice(1);
  if (d.length < 8 || d.length > 15) return "";
  return d;
}

export function NewDmDialog() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: contacts, isLoading } = useChatContacts(q);
  const startDm = useStartDm();
  const navigate = useNavigate();

  // Anggap query "nomor" kalau setelah dibersihkan tersisa >= 6 digit.
  const queryDigits = useMemo(() => q.replace(/\D/g, ""), [q]);
  const looksLikePhone = queryDigits.length >= 6;
  const invitePhone = useMemo(() => normalizeWaDigits(q), [q]);

  function inviteByWhatsApp() {
    if (!invitePhone) {
      toast.error("Nomor tidak valid. Contoh: 08123456789 atau 628123456789.");
      return;
    }
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://mcmstorage.biz";
    const msg = [
      "Halo! Saya mengundang Anda bergabung di aplikasi MCM Storage.",
      "",
      "Silakan daftar/masuk lewat tautan berikut, lalu kita bisa saling chat di dalam aplikasi:",
      origin,
    ].join("\n");
    const url = buildWhatsAppUrl(msg, invitePhone);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      toast.error("Popup diblokir browser. Izinkan popup lalu coba lagi.");
      return;
    }
    toast.success("Undangan WA dibuka untuk " + invitePhone);
  }

  const onPick = async (uid: string) => {
    try {
      const id = await startDm.mutateAsync(uid);
      setOpen(false);
      navigate({ to: "/chat/$conversationId", params: { conversationId: id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memulai chat");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" size="sm" className="gap-1.5">
          <MessageSquarePlus className="h-4 w-4" /> Chat baru
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mulai chat dengan kontak</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama atau nomor telepon…"
            className="pl-8"
            autoFocus
          />
        </div>
        <div className="max-h-80 space-y-1 overflow-auto rounded-md border p-1">
          {isLoading ? (
            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
            </div>
          ) : (contacts ?? []).length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-4 text-center">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                {looksLikePhone ? <Send className="h-5 w-5" /> : <Link2 className="h-5 w-5" />}
              </div>
              {looksLikePhone ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    Nomor <span className="font-medium text-foreground">{q}</span> belum terdaftar di aplikasi. Undang lewat WhatsApp agar dapat diajak chat.
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    onClick={inviteByWhatsApp}
                    disabled={!invitePhone}
                  >
                    <Send className="h-4 w-4" /> Undang via WhatsApp
                  </Button>
                  {!invitePhone && (
                    <p className="text-[11px] text-muted-foreground">
                      Format nomor belum valid (8–15 digit). Contoh: 08123456789.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="text-xs text-muted-foreground">
                    Belum ada kontak yang dapat diajak chat. Tautkan akun pelanggan/pemasok, atau ketik nomor WA untuk mengundang.
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setOpen(false);
                      navigate({ to: "/kontak" });
                    }}
                  >
                    <Link2 className="h-4 w-4" /> Siapkan kontak chat
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          ) : (
            (contacts ?? []).map((c) => (
              <button
                key={c.user_id}
                type="button"
                onClick={() => onPick(c.user_id)}
                disabled={startDm.isPending}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent disabled:opacity-50"
              >
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
                  <UserRound className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {c.display_name || c.phone || "Pengguna"}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {c.phone ? `${c.phone} · ` : ""}{c.label ?? c.kind}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}