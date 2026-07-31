/**
 * Alur pembayaran Rupiah lewat transfer bank.
 *
 * Penyedia pembayaran kartu tidak mendukung Rupiah, jadi jalur ini adalah
 * satu-satunya cara pelanggan Indonesia membayar dalam Rupiah asli. Pengguna
 * mengunggah bukti transfer ke bucket privat `payment-proofs` (folder per
 * user id, dikunci RLS) lalu admin memverifikasi lewat RPC
 * `admin_approve_payment` yang memperpanjang masa aktif langganan.
 */
import { useState } from "react";
import { Copy, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MANUAL_PRICE_IDR, formatIdr } from "@/lib/paddle";

/** Rekening tujuan transfer — ubah di sini bila rekening toko berganti. */
export const BANK_ACCOUNT = {
  bank: "BRI",
  number: "3423-01-000000-53-4",
  holder: "Mcm",
};

const MAX_PROOF_BYTES = 5 * 1024 * 1024;

export function ManualTransferDialog({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmitted?: () => void;
}) {
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [senderName, setSenderName] = useState("");
  const [senderBank, setSenderBank] = useState("");
  const [transferDate, setTransferDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = MANUAL_PRICE_IDR[cycle];

  const copyAccount = async () => {
    try {
      await navigator.clipboard.writeText(BANK_ACCOUNT.number.replace(/\D/g, ""));
      toast.success("Nomor rekening disalin");
    } catch {
      toast.error("Gagal menyalin, catat manual ya");
    }
  };

  const submit = async () => {
    const name = senderName.trim();
    if (name.length < 2) {
      toast.error("Isi nama pengirim transfer");
      return;
    }
    if (!file) {
      toast.error("Lampirkan foto bukti transfer");
      return;
    }
    if (file.size > MAX_PROOF_BYTES) {
      toast.error("Ukuran bukti maksimal 5 MB");
      return;
    }

    setBusy(true);
    const t = toast.loading("Mengirim bukti transfer…");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Sesi tidak ditemukan, masuk ulang.");

      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
      const path = `${uid}/${Date.now()}.${ext}`;
      const up = await supabase.storage
        .from("payment-proofs")
        .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
      if (up.error) throw new Error(up.error.message);

      const ins = await supabase.from("subscription_payments").insert({
        user_id: uid,
        amount_idr: amount,
        billing_cycle: cycle,
        sender_name: name,
        sender_bank: senderBank.trim() || null,
        transfer_date: transferDate,
        proof_path: path,
        status: "pending",
      });
      if (ins.error) throw new Error(ins.error.message);

      toast.success("Bukti terkirim — menunggu verifikasi admin", { id: t });
      setFile(null);
      setSenderName("");
      setSenderBank("");
      onOpenChange(false);
      onSubmitted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim bukti", { id: t });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bayar transfer bank (Rupiah)</DialogTitle>
          <DialogDescription>
            Transfer sesuai nominal, lalu unggah buktinya. Akses Pro dibuka
            setelah admin memverifikasi (biasanya di hari yang sama).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-ms-sm">
            <div className="text-ms-2xs text-muted-foreground">Rekening tujuan</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-medium tabular-nums">
                {BANK_ACCOUNT.bank} · {BANK_ACCOUNT.number}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={copyAccount}
                aria-label="Salin nomor rekening"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
            <div className="text-ms-2xs text-muted-foreground">
              a.n. {BANK_ACCOUNT.holder}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mt-cycle">Paket</Label>
            <Select value={cycle} onValueChange={(v) => setCycle(v as "monthly" | "yearly")}>
              <SelectTrigger id="mt-cycle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">
                  Bulanan — {formatIdr(MANUAL_PRICE_IDR.monthly)}
                </SelectItem>
                <SelectItem value="yearly">
                  Tahunan — {formatIdr(MANUAL_PRICE_IDR.yearly)}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-ms-2xs text-muted-foreground">
              Nominal yang harus ditransfer: <strong>{formatIdr(amount)}</strong>
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mt-name">Nama pengirim</Label>
              <Input
                id="mt-name"
                value={senderName}
                maxLength={80}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="Nama di rekening"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-bank">Bank pengirim</Label>
              <Input
                id="mt-bank"
                value={senderBank}
                maxLength={40}
                onChange={(e) => setSenderBank(e.target.value)}
                placeholder="BCA / BRI / dll"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mt-date">Tanggal transfer</Label>
            <Input
              id="mt-date"
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mt-proof">Bukti transfer (foto/JPG/PNG, maks 5 MB)</Label>
            <Input
              id="mt-proof"
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Batal
          </Button>
          <Button onClick={submit} disabled={busy} data-testid="submit-manual-payment">
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Kirim bukti
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}