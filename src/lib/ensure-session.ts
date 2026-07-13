import { supabase } from "@/integrations/supabase/client";

/**
 * Pastikan session Supabase masih valid sebelum operasi tulis (INSERT/UPDATE).
 *
 * Latar: `supabase.auth.getUser()` memvalidasi token ke server, tapi antara
 * pengecekan tersebut dan panggilan PostgREST berikutnya, token masih bisa
 * kadaluarsa atau autoRefresh belum sempat berjalan — akibatnya `auth.uid()`
 * di RLS = null dan CHECK gagal. Helper ini memaksa refresh proaktif ketika
 * token akan/sudah kadaluarsa, lalu mengembalikan uid untuk dipakai di payload.
 *
 * Lempar Error dengan pesan ramah bila session benar-benar hilang; pemanggil
 * boleh `notifyError` / `toast.error` dan menghentikan submit.
 */
export async function ensureFreshSession(): Promise<{ userId: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const session = sess.session;
  if (!session) {
    throw new Error("Sesi berakhir. Silakan login ulang.");
  }
  const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
  const now = Date.now();
  // Refresh jika sudah lewat, atau akan kadaluarsa < 60 detik lagi.
  if (!expiresAt || expiresAt - now < 60_000) {
    const { data: r, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !r.session?.user?.id) {
      throw new Error("Sesi berakhir. Silakan login ulang.");
    }
    return { userId: r.session.user.id };
  }
  const uid = session.user?.id;
  if (!uid) throw new Error("Sesi berakhir. Silakan login ulang.");
  return { userId: uid };
}