import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { buildWhatsAppUrl, buildWhatsAppBusinessIntentUrl } from "./share-wa";
import { copyText } from "./share-wa";
import { toast } from "sonner";

export type WaTarget = "business" | "regular";
export type WaTargetPref = "ask" | WaTarget;

const PREF_KEY = "wa-target-pref";

export function getWaTargetPref(): WaTargetPref {
  if (typeof window === "undefined") return "ask";
  try {
    const v = window.localStorage.getItem(PREF_KEY);
    if (v === "business" || v === "regular" || v === "ask") return v;
  } catch { /* ignore */ }
  return "ask";
}

export function setWaTargetPref(v: WaTargetPref) {
  try { window.localStorage.setItem(PREF_KEY, v); } catch { /* ignore */ }
}

type Request = {
  text?: string;
  phone?: string;
  resolve: (v: WaTarget | null) => void;
};

let openRequest: ((req: Request) => void) | null = null;
const queue: Request[] = [];

/**
 * Tanyakan target WhatsApp (Business / biasa). Mengembalikan pilihan, atau
 * null jika user membatalkan. Jika preferensi sudah disimpan (bukan "ask"),
 * langsung mengembalikan preferensi tanpa membuka dialog.
 */
export function pickWhatsAppTarget(ctx?: { text?: string; phone?: string }): Promise<WaTarget | null> {
  const pref = getWaTargetPref();
  if (pref !== "ask") return Promise.resolve(pref);
  return new Promise((resolve) => {
    const req: Request = { resolve, text: ctx?.text, phone: ctx?.phone };
    if (openRequest) openRequest(req);
    else queue.push(req);
  });
}

export function WhatsAppTargetHost() {
  const [current, setCurrent] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const [confirming, setConfirming] = useState<WaTarget | null>(null);

  useEffect(() => {
    openRequest = (req) => {
      setRemember(false);
      setConfirming(null);
      setCurrent(req);
      setOpen(true);
    };
    while (queue.length) {
      const req = queue.shift()!;
      setRemember(false);
      setConfirming(null);
      setCurrent(req);
      setOpen(true);
    }
    return () => { openRequest = null; };
  }, []);

  const finish = (v: WaTarget | null) => {
    setOpen(false);
    if (v && remember) setWaTargetPref(v);
    current?.resolve(v);
    setTimeout(() => {
      setCurrent(null);
      setConfirming(null);
    }, 150);
  };

  const text = current?.text ?? "";
  const phone = current?.phone;
  const businessUrl = buildWhatsAppBusinessIntentUrl(text, phone);
  const regularUrl = buildWhatsAppUrl(text, phone);
  const confirmUrl = confirming === "business" ? businessUrl : confirming === "regular" ? regularUrl : "";
  const confirmLabel = confirming === "business" ? "WhatsApp Business" : "WhatsApp biasa";

  const copy = async (url: string) => {
    const res = await copyText(url);
    if (res.ok) toast.success("URL disalin");
    else toast.error("Gagal menyalin URL");
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && finish(null)}>
      <AlertDialogContent>
        {confirming ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Buka {confirmLabel}?</AlertDialogTitle>
              <AlertDialogDescription>
                Periksa pratinjau URL di bawah. Aplikasi WhatsApp akan dibuka setelah Anda menyetujui.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="rounded-md border p-2">
              <div className="text-[11px] font-medium uppercase text-muted-foreground">URL yang akan dibuka</div>
              <code className="mt-1 block max-h-32 overflow-auto break-all rounded bg-muted p-2 text-[11px]">
                {confirmUrl}
              </code>
              <div className="mt-1 flex gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => copy(confirmUrl)}>
                  Salin URL
                </Button>
                <a
                  href={confirmUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary underline-offset-2 hover:underline self-center"
                >
                  Buka di tab baru
                </a>
              </div>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={remember}
                onCheckedChange={(c) => setRemember(c === true)}
              />
              Ingat pilihan saya (bisa diubah lagi nanti)
            </label>
            <div className="mt-2 flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>
                Kembali
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => finish(null)}>
                  Batal
                </Button>
                <Button type="button" onClick={() => finish(confirming)}>
                  Ya, buka {confirmLabel}
                </Button>
              </div>
            </div>
          </>
        ) : (
        <>
        <AlertDialogHeader>
          <AlertDialogTitle>Kirim lewat WhatsApp mana?</AlertDialogTitle>
          <AlertDialogDescription>
            Pilih aplikasi WhatsApp yang ingin dibuka. Pratinjau URL ditampilkan di bawah tiap opsi.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3">
          <div className="rounded-md border p-2">
            <Button
              type="button"
              onClick={() => setConfirming("business")}
              className="w-full justify-start"
            >
              WhatsApp Business
            </Button>
            <div className="mt-2 text-[11px] font-medium uppercase text-muted-foreground">URL yang dibuka</div>
            <code className="mt-1 block max-h-24 overflow-auto break-all rounded bg-muted p-2 text-[11px]">
              {businessUrl}
            </code>
            <div className="mt-1 flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => copy(businessUrl)}>
                Salin URL
              </Button>
              <a
                href={businessUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary underline-offset-2 hover:underline self-center"
              >
                Buka di tab baru
              </a>
            </div>
          </div>
          <div className="rounded-md border p-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirming("regular")}
              className="w-full justify-start"
            >
              WhatsApp biasa
            </Button>
            <div className="mt-2 text-[11px] font-medium uppercase text-muted-foreground">URL yang dibuka</div>
            <code className="mt-1 block max-h-24 overflow-auto break-all rounded bg-muted p-2 text-[11px]">
              {regularUrl}
            </code>
            <div className="mt-1 flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => copy(regularUrl)}>
                Salin URL
              </Button>
              <a
                href={regularUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary underline-offset-2 hover:underline self-center"
              >
                Buka di tab baru
              </a>
            </div>
          </div>
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={remember}
            onCheckedChange={(c) => setRemember(c === true)}
          />
          Ingat pilihan saya (bisa diubah lagi nanti)
        </label>
        <div className="mt-2 flex justify-end">
          <Button type="button" variant="ghost" onClick={() => finish(null)}>
            Batal
          </Button>
        </div>
        </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}