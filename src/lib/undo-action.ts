import { toast } from "sonner";

/**
 * Defer a destructive action by `delayMs` and show a toast with a "Batalkan" button.
 * If the user clicks Batalkan before the timer fires, `onCommit` is never called.
 * Returns a cancel function the caller can use to abort programmatically.
 */
export function scheduleUndo(opts: {
  label: string;
  description?: string;
  delayMs?: number;
  onCommit: () => void | Promise<void>;
  onCancel?: () => void;
}) {
  const delay = opts.delayMs ?? 5000;
  let cancelled = false;

  const timer = setTimeout(() => {
    if (cancelled) return;
    try {
      void opts.onCommit();
    } finally {
      toast.dismiss(toastId);
    }
  }, delay);

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(timer);
    opts.onCancel?.();
  };

  const toastId = toast(opts.label, {
    description: opts.description ?? `Akan diterapkan dalam ${Math.round(delay / 1000)} detik`,
    duration: delay,
    action: {
      label: "Batalkan",
      onClick: () => {
        cancel();
        toast.success("Dibatalkan");
      },
    },
  });

  return cancel;
}