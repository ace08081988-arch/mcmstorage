/**
 * Penjaga notifikasi "tersangkut".
 *
 * `toast.loading()` di sonner tidak punya durasi — kalau komponen pemanggil
 * keburu unmount (dialog ditutup, pindah halaman, WebView restart) toast
 * spinner-nya menempel selamanya dan menumpuk di layar.
 *
 * Modul ini membungkus `toast.loading` supaya setiap toast loading otomatis
 * dibubarkan setelah batas waktu, dan menyediakan `dismissStuckToasts()`
 * untuk membersihkan sisa toast saat berpindah rute.
 */
import { toast } from "sonner";

/** Batas hidup maksimum satu toast loading. */
const MAX_LOADING_MS = 20_000;

let installed = false;

export function installToastWatchdog(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const original = toast.loading.bind(toast) as typeof toast.loading;
  const patched = ((message: Parameters<typeof toast.loading>[0], data?: Parameters<typeof toast.loading>[1]) => {
    const id = original(message, data);
    window.setTimeout(() => {
      try {
        toast.dismiss(id);
      } catch {
        /* noop */
      }
    }, MAX_LOADING_MS);
    return id;
  }) as typeof toast.loading;

  try {
    (toast as unknown as Record<string, unknown>)["loading"] = patched;
  } catch {
    /* biarkan perilaku bawaan bila objek beku */
  }
}

/** Bersihkan semua toast (dipakai saat pindah rute). */
export function dismissAllToasts(): void {
  try {
    toast.dismiss();
  } catch {
    /* noop */
  }
}
