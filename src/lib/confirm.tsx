import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ConfirmOptions = {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button. Defaults to true when confirmText is "Hapus". */
  destructive?: boolean;
};

type Request = {
  options: ConfirmOptions;
  resolve: (v: boolean) => void;
};

let openRequest: ((req: Request) => void) | null = null;
const queue: Request[] = [];

/**
 * Global confirmation dialog. Replaces native window.confirm with a styled,
 * consistent AlertDialog. Safe to call from anywhere; resolves to true/false.
 */
export function confirm(options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req: Request = { options, resolve };
    if (openRequest) openRequest(req);
    else queue.push(req);
  });
}

export function ConfirmHost() {
  const [current, setCurrent] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    openRequest = (req) => {
      setCurrent(req);
      setOpen(true);
    };
    // Flush anything queued before mount.
    while (queue.length) {
      const req = queue.shift()!;
      setCurrent(req);
      setOpen(true);
    }
    return () => {
      openRequest = null;
    };
  }, []);

  const finish = (v: boolean) => {
    setOpen(false);
    current?.resolve(v);
    // Clear after the close animation.
    setTimeout(() => setCurrent(null), 150);
  };

  const opts = current?.options ?? {};
  const confirmText = opts.confirmText ?? "Oke";
  const destructive = opts.destructive ?? confirmText.toLowerCase() === "hapus";

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && finish(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts.title ?? "Konfirmasi"}</AlertDialogTitle>
          {opts.description ? (
            <AlertDialogDescription className="whitespace-pre-line">
              {opts.description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>
            {opts.cancelText ?? "Batal"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => finish(true)}
            className={
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}