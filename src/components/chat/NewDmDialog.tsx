import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, MessageSquarePlus, Search, UserRound, Link2, ArrowRight, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useChatContacts, useStartDm } from "@/lib/chat";
import { buildWhatsAppUrl } from "@/lib/share-wa";
import { z } from "zod";

// Normalisasi nomor → digit-only E.164 (tanpa "+").
// 0xxx → 62xxx, 00xxx → xxx; karakter selain digit/`+` dianggap invalid.
function normalizeWaDigits(raw: string): string {
  const trimmed = (raw ?? "").trim();
  // Hanya boleh berisi digit, spasi, tanda hubung, kurung, titik, atau awalan "+".
  if (!/^[+\d\s().-]+$/.test(trimmed)) return "";
  let d = trimmed.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "62" + d.slice(1);
  return d;
}

// Skema E.164: 8–15 digit, diawali 1–9 (kode negara tidak boleh 0).
const waPhoneSchema = z
  .string()
  .regex(/^[1-9]\d{7,14}$/, {
    message: "Nomor MCM harus 8–15 digit dan diawali kode negara yang valid.",
  });

type WaValidation =
  | { ok: true; phone: string }
  | { ok: false; phone: ""; reason: string };

function validateWaPhone(raw: string): WaValidation {
  if (!raw.trim()) return { ok: false, phone: "", reason: "Masukkan nomor terlebih dahulu." };
  const digits = normalizeWaDigits(raw);
  if (!digits) return { ok: false, phone: "", reason: "Format nomor tidak valid." };
  const parsed = waPhoneSchema.safeParse(digits);
  if (!parsed.success) {
    return { ok: false, phone: "", reason: parsed.error.issues[0]?.message ?? "Nomor tidak valid." };
  }
  return { ok: true, phone: parsed.data };
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
  const validation = useMemo(() => validateWaPhone(q), [q]);
  const invitePhone = validation.ok ? validation.phone : "";

  function inviteByWhatsApp() {
    if (!validation.ok) {
      toast.error(
        validation.reason +
          " Contoh format valid: 08123456789 atau 628123456789.",
      );
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
    // buildWhatsAppUrl meng-encode pesan; nomor sudah tervalidasi & digit-only.
    const url = buildWhatsAppUrl(msg, invitePhone);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      toast.error("Popup diblokir browser. Izinkan popup lalu coba lagi.");
      return;
    }
    toast.success("Undangan MCM dibuka untuk " + invitePhone);
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
                    Nomor <span className="font-medium text-foreground">{q}</span> belum terdaftar di aplikasi. Undang lewat MCM agar dapat diajak chat.
                  </div>
                  {invitePhone && (
                    <div className="text-[11px] text-muted-foreground">
                      Akan dikirim ke: <span className="font-mono text-foreground">+{invitePhone}</span>
                    </div>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    onClick={inviteByWhatsApp}
                    disabled={!validation.ok}
                  >
                    <Send className="h-4 w-4" /> Undang via MCM
                  </Button>
                  {!validation.ok && (
                    <p className="text-[11px] text-destructive">
                      {validation.reason} Contoh: 08123456789 atau 628123456789.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="text-xs text-muted-foreground">
                    Belum ada kontak yang dapat diajak chat. Tautkan akun pelanggan/pemasok, atau ketik nomor MCM untuk mengundang.
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