/**
 * SSOT untuk menerjemahkan kegagalan aksi chat (hapus/sembunyikan pesan)
 * menjadi pesan yang bisa dimengerti pengguna.
 *
 * Penting: UI TIDAK boleh sekadar menyembunyikan elemen ketika sebuah aksi
 * gagal. Setiap kegagalan harus muncul sebagai notifikasi dengan alasan yang
 * relevan (offline, izin, sesi habis, dsb) plus kode error mentah supaya
 * masih bisa diaudit dari screenshot.
 */
export type ChatErrorInfo = {
  title: string;
  description: string;
  /** true bila penyebabnya jaringan — layak untuk "Coba lagi". */
  retryable: boolean;
};

function rawMessage(e: unknown): string {
  if (!e) return "";
  if (typeof e === "string") return e;
  const anyE = e as { message?: string; details?: string; hint?: string; code?: string };
  return anyE.message || anyE.details || anyE.hint || anyE.code || "";
}

export function describeChatError(e: unknown, action = "menghapus pesan"): ChatErrorInfo {
  const msg = rawMessage(e);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const networkish =
    offline ||
    /failed to fetch|networkerror|network request failed|load failed|timeout|timed out|ecconnreset|fetch failed/i.test(
      msg,
    );

  if (networkish) {
    return {
      title: `Gagal ${action}`,
      description: offline
        ? "Perangkat sedang offline. Pesan belum dihapus di server — coba lagi setelah koneksi kembali."
        : `Koneksi ke server terputus. Pesan belum dihapus di server — coba lagi.${msg ? ` (${msg})` : ""}`,
      retryable: true,
    };
  }
  if (/forbidden|not_allowed|permission|row-level security|rls/i.test(msg)) {
    return {
      title: `Gagal ${action}`,
      description:
        "Anda tidak punya izin untuk aksi ini. Hanya pengirim pesan atau pemilik grup yang bisa menghapus untuk semua orang.",
      retryable: false,
    };
  }
  if (/unauthenticated|jwt|401/i.test(msg)) {
    return {
      title: `Gagal ${action}`,
      description: "Sesi Anda sudah berakhir. Masuk ulang lalu coba lagi.",
      retryable: false,
    };
  }
  if (/not_found/i.test(msg)) {
    return {
      title: "Pesan sudah tidak ada",
      description: "Pesan mungkin sudah dihapus dari perangkat lain.",
      retryable: false,
    };
  }
  return {
    title: `Gagal ${action}`,
    description: msg ? `Penyebab: ${msg}` : "Penyebab tidak diketahui. Coba lagi beberapa saat.",
    retryable: true,
  };
}
