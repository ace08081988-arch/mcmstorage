import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

/**
 * Upgrade akun chat-only ke akun MCM Storage penuh.
 *
 * Verifikasi: user harus memasukkan ulang password. Password diverifikasi
 * lewat signInWithPassword pada client Supabase tanpa persist (tidak
 * memengaruhi sesi yang sedang berjalan). Jika berhasil, kolom
 * `profiles.chat_only` di-set false.
 */
export const upgradeChatOnlyToStorage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ password: z.string().min(1, "Password wajib diisi") }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const email = (context.claims as { email?: string } | null)?.email;
    if (!email) {
      return { ok: false as const, error: "Email akun tidak ditemukan pada sesi." };
    }

    // Pastikan akun memang chat_only sebelum upgrade.
    const { data: prof, error: profErr } = await context.supabase
      .from("profiles")
      .select("chat_only")
      .eq("id", context.userId)
      .maybeSingle();
    if (profErr) {
      return { ok: false as const, error: "Gagal memuat profil: " + profErr.message };
    }
    if (!prof?.chat_only) {
      return { ok: false as const, error: "Akun ini bukan chat-only — tidak perlu di-upgrade." };
    }

    // Verifikasi password lewat client sekunder (tidak persist).
    const verifier = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    const { error: signInErr } = await verifier.auth.signInWithPassword({
      email,
      password: data.password,
    });
    if (signInErr) {
      return { ok: false as const, error: "Password salah. Coba lagi." };
    }

    // Update flag chat_only=false (RLS: user hanya bisa update profil sendiri).
    const { error: updErr } = await context.supabase
      .from("profiles")
      .update({ chat_only: false })
      .eq("id", context.userId);
    if (updErr) {
      return { ok: false as const, error: "Gagal mengubah status akun: " + updErr.message };
    }

    return { ok: true as const };
  });