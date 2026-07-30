/**
 * Peta error `getUserMedia` / WebRTC ke pesan yang jelas dalam bahasa
 * Indonesia + saran langkah perbaikan. Dipakai oleh UI panggilan agar
 * pengguna tidak melihat pesan mentah seperti "NotAllowedError".
 */

export type CallErrorInfo = {
  /** Judul singkat untuk toast/heading. */
  title: string;
  /** Penjelasan penyebab + langkah perbaikan. */
  hint: string;
};

type MediaErrorLike = {
  name?: string;
  message?: string;
};

function getErr(e: unknown): MediaErrorLike {
  if (e && typeof e === "object") return e as MediaErrorLike;
  return {};
}

/**
 * Terjemahkan error apa pun (termasuk `DOMException` dari getUserMedia)
 * ke {@link CallErrorInfo}. Selalu mengembalikan sesuatu yang aman
 * untuk ditampilkan ke pengguna.
 */
export function describeCallError(e: unknown, kind: "audio" | "video" = "audio"): CallErrorInfo {
  const err = getErr(e);
  const name = err.name ?? "";
  const message = err.message ?? "";

  // Browser/WebView tidak mendukung getUserMedia
  if (/tidak mendukung panggilan/i.test(message)) {
    return {
      title: "Perangkat tidak mendukung panggilan",
      hint: "Buka aplikasi lewat browser terbaru (Chrome/Edge) atau update aplikasi Android Anda.",
    };
  }

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        title: kind === "video" ? "Izin kamera & mikrofon ditolak" : "Izin mikrofon ditolak",
        hint:
          "Buka Pengaturan aplikasi → Izin → aktifkan Mikrofon" +
          (kind === "video" ? " dan Kamera" : "") +
          ", lalu coba panggil lagi. Di browser, tekan ikon gembok di address bar untuk memberi izin.",
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return {
        title: kind === "video" ? "Kamera/mikrofon tidak ditemukan" : "Mikrofon tidak ditemukan",
        hint:
          "Pastikan perangkat memiliki mikrofon" +
          (kind === "video" ? "/kamera" : "") +
          " yang aktif dan tidak dinonaktifkan di pengaturan sistem.",
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        title: "Perangkat sedang dipakai aplikasi lain",
        hint:
          "Tutup aplikasi lain yang memakai mikrofon" +
          (kind === "video" ? "/kamera" : "") +
          " (mis. WhatsApp, Zoom, browser lain), lalu coba panggil lagi.",
      };
    case "AbortError":
      return {
        title: "Panggilan dibatalkan",
        hint: "Perangkat membatalkan akses mikrofon. Coba lagi dalam beberapa detik.",
      };
    case "TypeError":
      return {
        title: "Koneksi tidak aman",
        hint:
          "Panggilan hanya berjalan lewat HTTPS. Pastikan Anda membuka aplikasi dari alamat resmi (https://…), bukan dari IP/lokal tanpa HTTPS.",
      };
  }

  // Fallback
  return {
    title: "Gagal memulai panggilan",
    hint: message || "Periksa koneksi internet dan izin perangkat, lalu coba lagi.",
  };
}

/** Format ringkas untuk `toast.error(title, { description: hint })`. */
export function toastArgsForCallError(e: unknown, kind: "audio" | "video" = "audio") {
  const info = describeCallError(e, kind);
  return [info.title, { description: info.hint }] as const;
}