import { Capacitor } from "@capacitor/core";

/**
 * Memicu unduhan APK secara andal di berbagai lingkungan runtime.
 *
 * Masalah: sebelumnya kami memakai `window.location.href = url` untuk
 * memicu unduhan. Di webview Capacitor Android, navigasi seperti itu
 * TIDAK selalu diteruskan sebagai unduhan — webview mencoba me-render
 * URL signed sebagai halaman, sehingga file APK tidak pernah masuk
 * folder Unduhan. Selain itu, `window.location.href` menggantikan tab
 * saat ini di browser desktop sehingga user "keluar" dari halaman.
 *
 * Strategi:
 *   1. Native Capacitor (Android APK) → buka URL signed di system
 *      browser via `AppLauncher.openUrl`. Chrome/browser sistem yang
 *      menerima `content-disposition: attachment` akan mengunduh APK
 *      ke folder Unduhan, dan installer sistem yang menangani.
 *   2. Browser web → buat <a> tersembunyi dengan atribut `download`
 *      + `target="_blank"` + `rel="noopener"`, panggil `click()` lalu
 *      lepas. Cara ini menang atas `location.href` karena:
 *        - `download` attr memperkuat sinyal unduh (browser tidak
 *          menavigasi tab utama meski signed URL sempat me-redirect).
 *        - `target=_blank` memisahkan konteks; tab aktif tetap di
 *          halaman Pengaturan.
 *   3. Fallback terakhir: `window.open(url, '_blank')` bila anchor
 *      diblokir; lalu `location.href = url` sebagai jaring pengaman.
 *
 * Return: `{ triggered: true, via }` bila salah satu jalur berhasil
 * dijalankan; melempar Error dengan `.code` untuk kegagalan yang
 * bisa ditampilkan pada toast.
 */
export type TriggerResult = {
  triggered: true;
  via: "capacitor-app-launcher" | "anchor-download" | "window-open" | "location-href";
};

export async function triggerApkDownload(
  url: string,
  fileName?: string | null,
): Promise<TriggerResult> {
  if (!url || typeof url !== "string") {
    const err = new Error("URL unduhan kosong.") as Error & { code?: string };
    err.code = "empty_url";
    throw err;
  }

  // 1. Native Capacitor → system browser
  if (typeof Capacitor !== "undefined" && Capacitor.isNativePlatform()) {
    try {
      const { AppLauncher } = await import("@capacitor/app-launcher");
      const res = await AppLauncher.openUrl({ url });
      if (res?.completed) {
        return { triggered: true, via: "capacitor-app-launcher" };
      }
      // Jika AppLauncher gagal (browser sistem tidak menerima),
      // jatuh ke fallback anchor supaya paling tidak dicoba.
    } catch {
      // fall through
    }
  }

  // 2. Anchor + download attribute
  if (typeof document !== "undefined") {
    try {
      const a = document.createElement("a");
      a.href = url;
      if (fileName) a.download = fileName;
      a.rel = "noopener";
      a.target = "_blank";
      // Chrome membutuhkan node terpasang ke DOM di beberapa versi.
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      // Lepas setelah tick agar klik sempat diproses.
      setTimeout(() => {
        try {
          a.remove();
        } catch {
          /* noop */
        }
      }, 0);
      return { triggered: true, via: "anchor-download" };
    } catch {
      // fall through
    }
  }

  // 3. window.open fallback
  if (typeof window !== "undefined") {
    try {
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (w) return { triggered: true, via: "window-open" };
    } catch {
      // fall through
    }
  }

  // 4. location.href jaring pengaman terakhir
  if (typeof window !== "undefined") {
    window.location.href = url;
    return { triggered: true, via: "location-href" };
  }

  const err = new Error("Tidak ada lingkungan untuk memicu unduhan.") as Error & {
    code?: string;
  };
  err.code = "no_runtime";
  throw err;
}