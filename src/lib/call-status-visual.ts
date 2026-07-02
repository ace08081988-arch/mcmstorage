import type { LucideIcon } from "lucide-react";
import {
  Phone, PhoneCall, PhoneMissed, PhoneOff, PhoneIncoming, PhoneOutgoing,
  Ban, AlertCircle, CheckCircle2,
} from "lucide-react";

/**
 * Pemetaan ikon, warna, label, dan hint status panggilan terpusat.
 * Wajib dipakai di semua tampilan panggilan agar konsisten:
 * - riwayat panggilan (/panggilan)
 * - layar panggilan aktif (CallScreen)
 * - komponen lain yang menampilkan status panggilan
 *
 * Warna dipilih agar terbaca baik di background terang maupun gelap.
 */
export type CallVisualStatus =
  | "missed"
  | "declined"
  | "cancelled"
  | "failed"
  | "ringing"
  | "dialing"
  | "connecting"
  | "in-call"
  | "ended";

export type CallStatusVisual = {
  Icon: LucideIcon;
  /** Kelas warna tailwind untuk ikon & teks status. */
  colorClass: string;
  /** Label singkat untuk badge/inline. */
  label: string;
  /** Deskripsi panjang untuk tooltip/toast. */
  hint: string;
};

export function getCallStatusVisual(
  status: CallVisualStatus,
  opts: { outgoing?: boolean } = {},
): CallStatusVisual {
  switch (status) {
    case "missed":
      return {
        Icon: PhoneMissed,
        colorClass: "text-red-500",
        label: "Tidak dijawab",
        hint: "Tidak dijawab — panggilan tidak diangkat penerima.",
      };
    case "declined":
      return {
        Icon: PhoneOff,
        colorClass: "text-amber-500",
        label: "Ditolak",
        hint: "Ditolak — penerima menolak panggilan.",
      };
    case "cancelled":
      return {
        Icon: Ban,
        colorClass: "text-amber-500",
        label: "Dibatalkan",
        hint: "Dibatalkan — panggilan dihentikan sebelum diangkat.",
      };
    case "failed":
      return {
        Icon: AlertCircle,
        colorClass: "text-red-500",
        label: "Gagal",
        hint: "Gagal — panggilan tidak dapat tersambung.",
      };
    case "ringing":
      return {
        Icon: Phone,
        colorClass: "text-sky-500",
        label: "Berdering…",
        hint: "Berdering — panggilan sedang menunggu dijawab.",
      };
    case "dialing":
      return {
        Icon: PhoneCall,
        colorClass: "text-sky-500",
        label: "Memanggil…",
        hint: "Memanggil — menunggu perangkat penerima.",
      };
    case "connecting":
      return {
        Icon: PhoneCall,
        colorClass: "text-sky-500",
        label: "Menghubungkan…",
        hint: "Menghubungkan — sedang menyiapkan panggilan.",
      };
    case "in-call":
      return {
        Icon: PhoneCall,
        colorClass: "text-emerald-500",
        label: "Tersambung",
        hint: "Diterima — panggilan sedang berlangsung.",
      };
    case "ended":
    default:
      // Untuk panggilan yang sudah diterima & selesai, arah panggilan
      // (masuk/keluar) tetap ditampilkan lewat ikon panah — permintaan
      // umum di riwayat panggilan. Bila arah tidak diketahui, pakai
      // CheckCircle2 sebagai simbol netral "diterima".
      if (opts.outgoing === true) {
        return {
          Icon: PhoneOutgoing,
          colorClass: "text-emerald-500",
          label: "Diterima",
          hint: "Diterima — panggilan keluar berhasil tersambung.",
        };
      }
      if (opts.outgoing === false) {
        return {
          Icon: PhoneIncoming,
          colorClass: "text-emerald-500",
          label: "Diterima",
          hint: "Diterima — panggilan masuk berhasil tersambung.",
        };
      }
      return {
        Icon: CheckCircle2,
        colorClass: "text-emerald-500",
        label: "Diterima",
        hint: "Diterima — panggilan berhasil tersambung.",
      };
  }
}
