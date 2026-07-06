import { toast } from "sonner";
import { copyText } from "@/lib/share-wa";
import { shortenUrlForToast } from "@/lib/shorten-url-for-toast";

/**
 * Salin URL ke clipboard sambil menampilkan toast. Jika `navigator.clipboard`
 * memblokir tulis (izin ditolak, konteks non-HTTPS, iframe tanpa clipboard-write)
 * dan fallback execCommand juga gagal, tampilkan toast persistent dengan URL
 * penuh siap disalin manual — pakai tombol "Salin manual" yang membuka
 * `window.prompt` (native, mudah long-press-copy di HP) plus URL penuh di
 * description agar pengguna bisa memilihnya dengan tangan.
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
  toast.error(`${reason} — salin manual`, {
    description: url,
    duration: 15_000,
    action: {
      label: "Salin manual",
      onClick: () => {
        try {
          // window.prompt menampilkan URL di kotak teks native yang bisa
          // di-long-press → copy di Android/iOS tanpa izin Clipboard API.
          if (typeof window !== "undefined") window.prompt("Salin URL berikut:", url);
        } catch {
          /* ignore */
        }
      },
    },
  });
  return false;
}
