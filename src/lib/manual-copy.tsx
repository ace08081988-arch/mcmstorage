import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { copyText } from "@/lib/share-wa";

type Request = { url: string; title?: string; description?: string };

let openRequest: ((req: Request) => void) | null = null;
const queue: Request[] = [];

/**
 * Tampilkan modal kustom berisi field URL yang bisa disalin lewat tombol
 * "Salin" — pengganti window.prompt agar UX konsisten di semua perangkat
 * (Android/iOS/desktop, termasuk WebView APK yang tidak selalu punya
 * prompt native). Field otomatis di-select on-open supaya siap Ctrl/⌘+C
 * atau long-press → copy.
 */
export function showManualCopy(url: string, opts?: { title?: string; description?: string }) {
  const req: Request = { url, ...opts };
  if (openRequest) openRequest(req);
  else queue.push(req);
}

export function ManualCopyHost() {
  const [current, setCurrent] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    openRequest = (req) => {
      setCurrent(req);
      setOpen(true);
    };
    while (queue.length) {
      const req = queue.shift()!;
      setCurrent(req);
      setOpen(true);
    }
    return () => {
      openRequest = null;
    };
  }, []);

  // Select isi field begitu modal terbuka supaya user langsung bisa copy.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      try {
        el.focus();
        el.select();
      } catch {
        /* ignore */
      }
    }, 50);
    return () => clearTimeout(t);
  }, [open, current?.url]);

  const close = () => {
    setOpen(false);
    setTimeout(() => setCurrent(null), 150);
  };

  const onCopy = async () => {
    if (!current) return;
    const res = await copyText(current.url);
    if (res.ok) {
      toast.success("URL disalin");
      close();
    } else {
      // Tetap biarkan modal terbuka — user bisa select manual di field.
      toast.error("Masih gagal — pilih teks lalu salin manual");
      try {
        inputRef.current?.focus();
        inputRef.current?.select();
      } catch {
        /* ignore */
      }
    }
  };

  const url = current?.url ?? "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{current?.title ?? "Salin URL manual"}</DialogTitle>
          <DialogDescription>
            {current?.description ??
              "Clipboard otomatis diblokir. Tekan Salin atau pilih teks di kotak lalu salin sendiri."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="manual-copy-url" className="text-xs">
            URL
          </Label>
          <Input
            id="manual-copy-url"
            ref={inputRef}
            value={url}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Tutup
          </Button>
          <Button onClick={onCopy}>Salin</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
