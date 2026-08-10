import { toast } from "sonner";
import { copyText } from "@/lib/share-wa";
import { shortenUrlForToast } from "@/lib/shorten-url-for-toast";
import { showManualCopy } from "@/lib/manual-copy";

/**
 * Salin URL ke clipboard sambil menampilkan toast. Jika `navigator.clipboard`
 * memblokir tulis (izin ditolak, konteks non-HTTPS, iframe tanpa clipboard-write)
 * dan fallback execCommand juga gagal, tampilkan toast persistent dengan URL
 * penuh siap disalin manual — pakai tombol "Salin manual" yang membuka
 * modal kustom (`ManualCopyHost`) berisi field URL + tombol Salin, supaya
 * UX konsisten di semua perangkat (Android/iOS/desktop/WebView APK) tanpa
 * bergantung pada `window.prompt` yang tampilannya beda-beda.
 */
export async function copyUrlWithToast(url: string, successLabel: string): Promise<boolean> {
  const res = await copyText(url);
  const preview = shortenUrlForToast(url);
  if (res.ok) {
    toast.success(successLabel, { description: preview });
    return true;
  }
  const reason =
    res.reason === "denied"
      ? "Izin clipboard ditolak"
      : res.reason === "unsupported"
      ? "Browser tidak mendukung clipboard otomatis"
      : "Gagal menyalin";
  // Judul toast: URL ringkas → user langsung tahu link mana yang gagal
  //   disalin (kalau ada beberapa toast berdempetan).
  // Deskripsi: URL penuh → siap dipilih & di-copy langsung dari toast di
  //   desktop; di HP tombol "Salin manual" membuka modal dengan field
  //   URL + tombol Salin. Alasan (izin/unsupported) disisipkan sebelum
  //   URL penuh supaya konteks tidak hilang.
  toast.error(preview, {
    description: `${reason}. ${url}`,
    duration: 15_000,
    action: {
      label: "Salin manual",
      onClick: () => {
        // Buka modal kustom dengan field URL read-only + tombol Salin.
        showManualCopy(url);
      },
    },
  });
  return false;
}
