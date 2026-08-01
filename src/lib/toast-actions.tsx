/**
 * Helper toast beraksi (Undo / Lihat Detail) dengan gaya Noir & Gold.
 *
 * Semua styling tombol diambil dari `toastOptions.classNames` global di
 * `src/routes/__root.tsx` (actionButton = aksen emas, cancelButton =
 * netral berbingkai), jadi helper ini hanya mengurus perilaku.
 */
import { toast } from "sonner";

type ToastId = string | number;

export type ToastActionOptions = {
  description?: string;
  /** ms; default 6000 supaya sempat ditekan di HP. */
  duration?: number;
  /** Label tombol sekunder (opsional). */
  cancelLabel?: string;
  onCancel?: () => void;
};

/** Toast netral dengan satu tombol aksi bebas. */
export function toastWithAction(
  message: string,
  action: { label: string; onClick: () => void | Promise<void> },
  opts: ToastActionOptions = {},
): ToastId {
  const { description, duration = 6000, cancelLabel, onCancel } = opts;
  return toast(message, {
    description,
    duration,
    action: {
      label: action.label,
      onClick: () => {
        void action.onClick();
      },
    },
    ...(cancelLabel
      ? { cancel: { label: cancelLabel, onClick: () => onCancel?.() } }
      : {}),
  });
}

/**
 * Toast sukses dengan tombol "Undo".
 * `onUndo` dipanggil sekali; error di dalamnya ditampilkan sebagai toast error.
 */
export function toastUndo(
  message: string,
  onUndo: () => void | Promise<void>,
  opts: ToastActionOptions & { undoLabel?: string } = {},
): ToastId {
  const { undoLabel = "Undo", duration = 8000, description } = opts;
  let used = false;
  return toast.success(message, {
    description,
    duration,
    action: {
      label: undoLabel,
      onClick: () => {
        if (used) return;
        used = true;
        void (async () => {
          try {
            await onUndo();
            toast.success("Dibatalkan.");
          } catch (e) {
            toast.error((e as Error)?.message || "Gagal membatalkan.");
          }
        })();
      },
    },
  });
}

/**
 * Toast dengan tombol "Lihat Detail". Beri `onView` untuk navigasi via
 * router, atau `href` untuk pindah halaman biasa.
 */
export function toastDetail(
  message: string,
  target: { onView?: () => void; href?: string; label?: string },
  opts: ToastActionOptions = {},
): ToastId {
  const { label = "Lihat Detail", onView, href } = target;
  return toastWithAction(
    message,
    {
      label,
      onClick: () => {
        if (onView) onView();
        else if (href) window.location.assign(href);
      },
    },
    { duration: 7000, ...opts },
  );
}
