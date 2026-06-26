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
  resolve: (v: WaTarget | null) => void;
};

let openRequest: ((req: Request) => void) | null = null;
const queue: Request[] = [];

/**
 * Tanyakan target WhatsApp (Business / biasa). Mengembalikan pilihan, atau
 * null jika user membatalkan. Jika preferensi sudah disimpan (bukan "ask"),
 * langsung mengembalikan preferensi tanpa membuka dialog.
 */
export function pickWhatsAppTarget(): Promise<WaTarget | null> {
  const pref = getWaTargetPref();
  if (pref !== "ask") return Promise.resolve(pref);
  return new Promise((resolve) => {
    const req: Request = { resolve };
    if (openRequest) openRequest(req);
    else queue.push(req);
  });
}

export function WhatsAppTargetHost() {
  const [current, setCurrent] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    openRequest = (req) => {
      setRemember(false);
      setCurrent(req);
      setOpen(true);
    };
    while (queue.length) {
      const req = queue.shift()!;
      setRemember(false);
      setCurrent(req);
      setOpen(true);
    }
    return () => { openRequest = null; };
  }, []);

  const finish = (v: WaTarget | null) => {
    setOpen(false);
    if (v && remember) setWaTargetPref(v);
    current?.resolve(v);
    setTimeout(() => setCurrent(null), 150);
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && finish(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kirim lewat WhatsApp mana?</AlertDialogTitle>
          <AlertDialogDescription>
            Pilih aplikasi WhatsApp yang ingin dibuka.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Button
            type="button"
            onClick={() => finish("business")}
            className="w-full justify-start"
          >
            WhatsApp Business
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => finish("regular")}
            className="w-full justify-start"
          >
            WhatsApp biasa
          </Button>
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
      </AlertDialogContent>
    </AlertDialog>
  );
}