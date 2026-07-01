import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Download, Maximize2, MessageSquare, Minimize2, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  email: string | null;
  phone: string | null;
  userId: string | null;
  avatarUrl?: string | null;
  /** Nomor khusus SMS; kalau kosong dipakai `phone`. */
  smsPhone?: string | null;
  /** Pesan awal yang akan mengisi kolom SMS saat pemindai membuka `sms:`. */
  smsMessage?: string | null;
};

/**
 * Bangun payload vCard 3.0 supaya pemindai (kamera bawaan HP) langsung
 * menawarkan "Simpan kontak" alih-alih membuka URL asing.
 *
 * Untuk memicu tindakan telepon/email dari QR (bukan cuma teks), setiap
 * TEL/EMAIL ditulis juga sebagai baris URL tel:/mailto: dan sebagai
 * VALUE=uri (dikenali vCard 4-aware scanner). Baris klasik tetap ada
 * untuk kompatibilitas iOS/Android bawaan.
 */
export function normalizePhoneForTel(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}

function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

function buildSmsUri(number: string, message: string): string {
  // iOS: sms:+62...&body=..., Android: sms:+62...?body=... — kedua bentuk
  // umumnya diterima. Pakai `?` sebagai pemisah utama (lebih luas didukung).
  const num = normalizePhoneForTel(number);
  if (!num) return "";
  return message ? `sms:${num}?body=${encodeURIComponent(message)}` : `sms:${num}`;
}

function buildVCard(
  name: string,
  email: string | null,
  phone: string | null,
  url: string,
  smsPhone: string | null,
  smsMessage: string | null,
): string {
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1");
  const lines: string[] = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${esc(name)}`,
    `N:${esc(name)};;;;`,
  ];

  const telNumber = phone ? normalizePhoneForTel(phone) : "";
  if (telNumber) {
    // Baris klasik — pemindai default Android/iOS menampilkan "Panggil".
    lines.push(`TEL;TYPE=CELL,VOICE:${esc(telNumber)}`);
    // vCard 4-style URI (banyak pemindai modern memakainya untuk memicu tel:).
    lines.push(`TEL;TYPE=CELL,VOICE;VALUE=uri:tel:${esc(telNumber)}`);
  }

  const smsNumber = smsPhone ? normalizePhoneForTel(smsPhone) : telNumber;
  const smsBody = (smsMessage ?? "").trim().slice(0, 500);
  if (smsNumber) {
    // Tandai nomor sebagai SMS-capable (TYPE=TEXT/MSG) supaya kartu kontak
    // yang tersimpan menampilkan tombol Kirim Pesan di iOS/Android.
    lines.push(`TEL;TYPE=CELL,TEXT,MSG:${esc(smsNumber)}`);
    const uri = buildSmsUri(smsNumber, smsBody);
    if (uri) {
      lines.push(`TEL;TYPE=CELL,TEXT;VALUE=uri:${esc(uri)}`);
      // Baris URL cadangan: kalau pemindai memilih membuka "link" alih-alih
      // menyimpan kontak, tautan ini langsung memicu aplikasi SMS.
      lines.push(`URL;TYPE=sms:${esc(uri)}`);
    }
    if (smsBody) {
      // Simpan pesan awal sebagai catatan supaya pemilik kontak juga bisa
      // melihat konteks pesan yang direncanakan.
      lines.push(`NOTE:${esc(`SMS: ${smsBody}`)}`);
    }
  }

  const emailAddr = email && isValidEmail(email) ? email.trim() : "";
  if (emailAddr) {
    lines.push(`EMAIL;TYPE=INTERNET:${esc(emailAddr)}`);
    lines.push(`EMAIL;TYPE=INTERNET;VALUE=uri:mailto:${esc(emailAddr)}`);
  }

  // Baris URL tambahan: kalau pemindai memilih membuka "link", biar link-nya
  // langsung tindakan yang benar, bukan sekadar teks.
  if (telNumber) lines.push(`URL;TYPE=tel:tel:${esc(telNumber)}`);
  if (emailAddr) lines.push(`URL;TYPE=email:mailto:${esc(emailAddr)}`);
  if (url) lines.push(`URL:${esc(url)}`);

  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export function ProfileQrDialog({
  open,
  onOpenChange,
  name,
  email,
  phone,
  userId,
  smsPhone,
  smsMessage,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [smsDraft, setSmsDraft] = useState<string>(smsMessage ?? "");
  const [showSmsField, setShowSmsField] = useState<boolean>(Boolean(smsMessage));
  useEffect(() => {
    setSmsDraft(smsMessage ?? "");
    setShowSmsField(Boolean(smsMessage));
  }, [smsMessage, open]);

  const profileUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const origin = window.location.origin;
    return userId ? `${origin}/u/${userId}` : origin;
  }, [userId]);

  const payload = useMemo(
    () => buildVCard(name, email, phone, profileUrl, smsPhone ?? null, smsDraft),
    [name, email, phone, profileUrl, smsPhone, smsDraft],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const url = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 512,
          color: { dark: "#0f172a", light: "#ffffff" },
        });
        if (cancelled) return;
        setDataUrl(url);
        setError(null);
        if (canvasRef.current) {
          await QRCode.toCanvas(canvasRef.current, payload, {
            errorCorrectionLevel: "M",
            margin: 2,
            width: 512,
            color: { dark: "#0f172a", light: "#ffffff" },
          });
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message || "Gagal membuat QR");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, payload]);

  const filename = `qr-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "profil"}.png`;

  const handleDownload = () => {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("QR profil diunduh.");
  };

  const handleShare = async () => {
    if (!dataUrl) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], filename, { type: "image/png" });
      // Web Share API level 2 (file) — sesuai preferensi: gunakan Share bukan window.open.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `QR profil ${name}`, text: name });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: `QR profil ${name}`, text: name, url: profileUrl });
        return;
      }
      handleDownload();
    } catch (e) {
      const msg = (e as Error).message || "";
      if (!/aborted|cancel/i.test(msg)) toast.error("Gagal membagikan QR.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={fullscreen ? "h-svh max-w-none w-svw rounded-none p-0" : "max-w-md"}>
        <DialogHeader className={fullscreen ? "px-4 pt-4" : ""}>
          <DialogTitle>Kode QR profil</DialogTitle>
          <DialogDescription className="truncate">
            {name}
            {phone ? ` · ${phone}` : email ? ` · ${email}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className={fullscreen ? "flex flex-1 items-center justify-center p-4" : "flex items-center justify-center py-2"}>
          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-border">
              <canvas
                ref={canvasRef}
                aria-label={`Kode QR untuk ${name}`}
                className={fullscreen ? "h-[min(80svh,80svw)] w-[min(80svh,80svw)]" : "h-64 w-64"}
              />
            </div>
          )}
        </div>

        {(phone || smsPhone) && (
          <div className={fullscreen ? "px-4" : ""}>
            {showSmsField ? (
              <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
                <Label
                  htmlFor="qr-sms-body"
                  className="flex items-center gap-1.5 text-[11px] font-medium"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Pesan SMS awal (otomatis terisi saat QR dipindai)
                </Label>
                <Textarea
                  id="qr-sms-body"
                  value={smsDraft}
                  onChange={(e) => setSmsDraft(e.target.value.slice(0, 500))}
                  placeholder={`Halo ${name}, saya ingin bertanya…`}
                  rows={2}
                  className="text-xs"
                />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Kirim ke: {smsPhone || phone}</span>
                  <span className="tabular-nums">{smsDraft.length}/500</span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSmsField(true)}
                className="flex items-center gap-1.5 text-[11px] text-primary underline"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Tambah pesan SMS awal
              </button>
            )}
          </div>
        )}

        <div className={fullscreen ? "flex flex-wrap gap-2 border-t bg-background px-4 py-3" : "flex flex-wrap gap-2 pt-2"}>
          <Button type="button" onClick={handleDownload} disabled={!dataUrl} className="gap-2">
            <Download className="h-4 w-4" /> Unduh PNG
          </Button>
          <Button type="button" variant="secondary" onClick={handleShare} disabled={!dataUrl} className="gap-2">
            <Share2 className="h-4 w-4" /> Bagikan
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setFullscreen((v) => !v)}
            className="ml-auto gap-2"
            aria-pressed={fullscreen}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {fullscreen ? "Keluar layar penuh" : "Layar penuh"}
          </Button>
          {fullscreen ? (
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} aria-label="Tutup">
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}