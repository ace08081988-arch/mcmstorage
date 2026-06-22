import { useState } from "react";
import { RefreshCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type Props = {
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  label?: string;
  fullWidth?: boolean;
};

export function ResetCacheButton({
  variant = "outline",
  size = "sm",
  className,
  label = "Reset cache aplikasi",
  fullWidth,
}: Props) {
  const [busy, setBusy] = useState(false);

  const handleReset = async () => {
    setBusy(true);
    try {
      // 1. Unregister all service workers
      if ("serviceWorker" in navigator) {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.allSettled(regs.map((r) => r.unregister()));
        } catch {
          /* ignore */
        }
      }
      // 2. Clear Cache Storage
      if ("caches" in window) {
        try {
          const keys = await caches.keys();
          await Promise.allSettled(keys.map((k) => caches.delete(k)));
        } catch {
          /* ignore */
        }
      }
      // 3. Clear local & session storage (preserve Supabase auth so user stays signed in)
      try {
        const preserved: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
            const v = localStorage.getItem(key);
            if (v) preserved[key] = v;
          }
        }
        localStorage.clear();
        for (const [k, v] of Object.entries(preserved)) {
          localStorage.setItem(k, v);
        }
      } catch {
        /* ignore */
      }
      try {
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
      // 4. Clear IndexedDB (best-effort)
      try {
        // @ts-expect-error - databases() is not in older TS lib
        const dbs: { name?: string }[] = (await indexedDB.databases?.()) ?? [];
        await Promise.allSettled(
          dbs
            .map((d) => d.name)
            .filter((n): n is string => !!n)
            .map(
              (name) =>
                new Promise<void>((resolve) => {
                  const req = indexedDB.deleteDatabase(name);
                  req.onsuccess = () => resolve();
                  req.onerror = () => resolve();
                  req.onblocked = () => resolve();
                }),
            ),
        );
      } catch {
        /* ignore */
      }

      toast.success("Cache aplikasi dibersihkan. Memuat ulang…");
      setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("_r", Date.now().toString());
        window.location.replace(url.toString());
      }, 400);
    } catch (err) {
      console.error("reset cache failed", err);
      toast.error("Gagal mereset cache. Coba lagi.");
      setBusy(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={busy}
          className={`${fullWidth ? "w-full " : ""}${className ?? ""}`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          <span>{label}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset cache aplikasi?</AlertDialogTitle>
          <AlertDialogDescription>
            Ini akan menghapus cache, service worker, dan data lokal sementara
            lalu memuat ulang halaman. Sesi login Anda dipertahankan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
          <AlertDialogAction onClick={handleReset} disabled={busy}>
            Ya, reset sekarang
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ResetCacheButton;