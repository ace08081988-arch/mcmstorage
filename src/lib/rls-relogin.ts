/**
 * Penanganan ramah-pengguna untuk penolakan RLS (kode Postgres 42501).
 *
 * Gejalanya: user menekan "Daftarkan pelanggan" lalu hanya melihat pesan
 * teknis "new row violates row-level security policy" dan buntu. Penyebab
 * paling umum adalah sesi basi (token rotate / berakhir) sehingga
 * `auth.uid()` tidak cocok dengan `user_id` di payload.
 *
 * Helper ini menampilkan toast dengan dua jalan keluar:
 *  - "Coba lagi": refresh sesi diam-diam lalu jalankan ulang aksinya.
 *  - "Masuk ulang": keluar dan arahkan ke /auth dengan tujuan kembali.
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type UnknownError = { code?: string; message?: string; status?: number } | null | undefined;

/** True bila error berasal dari penolakan row-level security / izin. */
export function isRlsDenied(error: unknown): boolean {
  const e = error as UnknownError;
  if (!e) return false;
  if (e.code === "42501") return true;
  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("row-level security") ||
    msg.includes("row level security") ||
    msg.includes("violates row-level") ||
    (msg.includes("permission denied") && msg.includes("table"))
  );
}

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}` || "/";
}

/** Keluar lalu arahkan ke halaman masuk, kembali ke halaman ini setelah login. */
export async function goRelogin(): Promise<void> {
  const back = currentPath();
  try {
    await supabase.auth.signOut();
  } catch {
    /* abaikan: tetap arahkan ke halaman masuk */
  }
  if (typeof window !== "undefined") {
    window.location.href = `/auth?redirect=${encodeURIComponent(back)}`;
  }
}

export type RlsReloginOptions = {
  /** Kalimat konteks, mis. "Gagal mendaftarkan pelanggan." */
  message?: string;
  /** Dijalankan ulang setelah sesi berhasil disegarkan. */
  onRetry?: () => void | Promise<void>;
};

/**
 * Tampilkan prompt re-login bila `error` adalah penolakan RLS.
 * Mengembalikan true bila error ditangani di sini (pemanggil tidak perlu
 * menampilkan toast error lain).
 */
export function notifyRlsRelogin(error: unknown, opts: RlsReloginOptions = {}): boolean {
  if (!isRlsDenied(error)) return false;
  const { message = "Gagal menyimpan data.", onRetry } = opts;

  const runRetry = async (id: string | number) => {
    toast.dismiss(id);
    const loading = toast.loading("Menyegarkan sesi…");
    try {
      const { data, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr || !data.session) throw refreshErr ?? new Error("no session");
      toast.dismiss(loading);
      if (onRetry) {
        await onRetry();
      } else {
        toast.success("Sesi disegarkan. Silakan coba simpan lagi.");
      }
    } catch {
      toast.dismiss(loading);
      toast.error("Sesi tidak bisa disegarkan.", {
        description: "Silakan masuk ulang untuk melanjutkan.",
        duration: 12000,
        action: { label: "Masuk ulang", onClick: () => void goRelogin() },
      });
    }
  };

  const id = toast.error(message, {
    description:
      "Sesi Anda kedaluwarsa sehingga server menolak penyimpanan. Segarkan sesi lalu coba lagi, atau masuk ulang.",
    duration: 15000,
    action: { label: "Coba lagi", onClick: () => void runRetry(id) },
    cancel: { label: "Masuk ulang", onClick: () => void goRelogin() },
  });
  return true;
}
