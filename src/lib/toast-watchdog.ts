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
/** Durasi minimum toast error supaya sempat terbaca. */
const ERROR_MIN_MS = 10_000;
/** Id semua toast loading yang masih hidup. */
const loadingIds = new Set<string | number>();

export function installToastWatchdog(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const original = toast.loading.bind(toast) as typeof toast.loading;
  const patched = ((message: Parameters<typeof toast.loading>[0], data?: Parameters<typeof toast.loading>[1]) => {
    const id = original(message, data);
    loadingIds.add(id);
    window.setTimeout(() => {
      try {
        toast.dismiss(id);
      } catch {
        /* noop */
      }
      loadingIds.delete(id);
    }, MAX_LOADING_MS);
    return id;
  }) as typeof toast.loading;

  try {
    (toast as unknown as Record<string, unknown>)["loading"] = patched;
  } catch {
    /* biarkan perilaku bawaan bila objek beku */
  }

  // Toast error bawaan ikut durasi global (4 detik) — terlalu singkat untuk
  // pesan kegagalan. Panjangkan kecuali pemanggil sudah menentukan sendiri.
  const originalError = toast.error.bind(toast) as typeof toast.error;
  const patchedError = ((
    message: Parameters<typeof toast.error>[0],
    data?: Parameters<typeof toast.error>[1],
  ) => originalError(message, { duration: ERROR_MIN_MS, ...(data ?? {}) })) as typeof toast.error;
  try {
    (toast as unknown as Record<string, unknown>)["error"] = patchedError;
  } catch {
    /* noop */
  }
}

/**
 * Bersihkan hanya toast loading yang berpotensi tersangkut (dipakai saat
 * pindah rute). Toast error/sukses/aksi dibiarkan hidup sampai durasinya
 * habis atau ditutup pengguna.
 */
export function dismissStuckToasts(): void {
  for (const id of loadingIds) {
    try {
      toast.dismiss(id);
    } catch {
      /* noop */
    }
  }
  loadingIds.clear();
}

/** Bersihkan semua toast tanpa terkecuali (dipakai untuk reset menyeluruh). */
export function dismissAllToasts(): void {
  try {
    toast.dismiss();
  } catch {
    /* noop */
  }
  loadingIds.clear();
}
