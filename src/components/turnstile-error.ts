/**
 * Mapping kode error Cloudflare Turnstile → penjelasan aksionable
 * dalam Bahasa Indonesia. Referensi:
 * https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
 *
 * Kode paling penting untuk kita:
 *   - 110200: hostname saat ini TIDAK ada di allowlist site key.
 *             Perlu action admin di dashboard Cloudflare Turnstile.
 *   - 300xxx / 600xxx: challenge gagal / expired; user cukup coba ulang.
 *   - 400xxx: masalah jaringan; retry.
 */
export type TurnstileErrorInfo = {
  code: string;
  /** Ringkasan singkat untuk ditampilkan ke user. */
  message: string;
  /**
   * True jika masalah ada di sisi konfigurasi (butuh admin), bukan sisi user.
   * Retry di user tidak akan menyelesaikan — perlu action di dashboard.
   */
  adminAction: boolean;
  /** Petunjuk aksi yang aman ditampilkan ke user / admin. */
  hint: string;
};

export function explainTurnstileError(
  code: string,
  hostname?: string,
): TurnstileErrorInfo {
  const host = hostname ?? "";
  if (code === "110200") {
    return {
      code,
      message: `Domain ${host || "saat ini"} belum diizinkan di Turnstile.`,
      adminAction: true,
      hint:
        "Admin: tambahkan domain ini ke allowlist site key di dashboard Cloudflare Turnstile, lalu buka ulang halaman.",
    };
  }
  if (code.startsWith("110")) {
    return {
      code,
      message: "Konfigurasi Turnstile bermasalah.",
      adminAction: true,
      hint:
        "Admin: verifikasi site key & allowlist domain di Cloudflare Turnstile.",
    };
  }
  if (code.startsWith("300") || code.startsWith("600")) {
    return {
      code,
      message: "Verifikasi manusia gagal / kedaluwarsa.",
      adminAction: false,
      hint: "Tekan tombol Coba lagi untuk memuat ulang widget CAPTCHA.",
    };
  }
  if (code === "400020") {
    return {
      code,
      message: `Konfigurasi Turnstile tidak cocok dengan domain ${host || "saat ini"}.`,
      adminAction: true,
      hint:
        "Admin: pastikan Site Key di /admin/turnstile sesuai widget Cloudflare, dan hostname ini sudah ada di Hostname Management widget tersebut. Ini bukan gangguan jaringan.",
    };
  }
  if (code.startsWith("400")) {
    return {
      code,
      message: "Gangguan jaringan saat verifikasi Turnstile.",
      adminAction: false,
      hint: "Cek koneksi internet, lalu tekan Coba lagi.",
    };
  }
  return {
    code,
    message: "Verifikasi CAPTCHA bermasalah.",
    adminAction: false,
    hint: "Tekan Coba lagi. Jika terus terjadi, muat ulang halaman.",
  };
}