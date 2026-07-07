import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

// Kode error yang dipakai UI untuk menampilkan pesan yang jelas ke pengguna.
export type SecureSignUpErrorCode =
  | "invalid_input"
  | "captcha_missing"
  | "captcha_failed"
  | "rate_limited"
  | "email_exists"
  | "weak_password"
  | "server_misconfigured"
  | "server_error";

export type SecureSignUpResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      code: SecureSignUpErrorCode;
      message: string;
      retryAfterSeconds?: number;
    };

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(200),
  // Turnstile dihapus — field diterima tapi diabaikan (kompat pemanggil lama).
  turnstileToken: z.string().max(4096).optional(),
  chatOnly: z.boolean().optional().default(false),
});

function clientIpFromRequest(req: Request): string {
  // Cloudflare / Lovable edge menyisipkan header berikut; ambil yang paling
  // dapat dipercaya lebih dulu, fallback ke x-forwarded-for pertama.
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return "0.0.0.0";
}

/**
 * Implementasi murni handler `secureSignUp` — diekspor terpisah agar bisa
 * di-unit/integration-test tanpa runtime `createServerFn`/Start context.
 * `secureSignUp` di bawah hanya membungkusnya dengan validator + RPC layer.
 */
export async function secureSignUpImpl(
  data: z.infer<typeof inputSchema>,
  req: Request,
): Promise<SecureSignUpResult> {
    const ip = clientIpFromRequest(req);
    const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 512) || null;

    // Turnstile dihapus — langsung ke rate-limit + createUser.

    // 2) Rate limit per IP (12 per jam) via RPC berhak akses service_role.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rate = await supabaseAdmin.rpc(
      "check_and_record_signup_attempt" as never,
      { p_ip: ip, p_email: data.email, p_user_agent: userAgent } as never,
    );
    // Bentuk balikannya: setof (allowed, attempts_in_window, retry_after_seconds).
    const row = Array.isArray(rate.data) ? (rate.data[0] as
      | { allowed: boolean; attempts_in_window: number; retry_after_seconds: number }
      | undefined) : undefined;
    if (rate.error || !row) {
      console.error("[secureSignUp] rate check failed", rate.error);
      return {
        ok: false,
        code: "server_error",
        message: "Terjadi gangguan sesaat. Coba lagi beberapa saat lagi.",
      };
    }
    if (!row.allowed) {
      const mins = Math.max(1, Math.ceil(row.retry_after_seconds / 60));
      return {
        ok: false,
        code: "rate_limited",
        message:
          "Terlalu banyak percobaan pendaftaran dari jaringan Anda (batas 12 per jam). " +
          "Coba lagi dalam ~" +
          mins +
          " menit.",
        retryAfterSeconds: row.retry_after_seconds,
      };
    }

    // 3) Buat akun via admin API TANPA email_confirm — user harus klik link
    // verifikasi yang dikirim lewat auth webhook Lovable Emails sebelum bisa login.
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: false,
      user_metadata: { chat_only: data.chatOnly },
    });
    // Kirim email konfirmasi signup via generateLink → memicu auth webhook.
    if (!error && created?.user) {
      try {
        await supabaseAdmin.auth.admin.generateLink({
          type: "signup",
          email: data.email,
          password: data.password,
        });
      } catch (linkErr) {
        console.warn("[secureSignUp] gagal memicu email verifikasi", linkErr);
      }
    }
    if (error) {
      const msg = error.message || "";
      if (/already|exists|registered|duplicate/i.test(msg)) {
        return {
          ok: false,
          code: "email_exists",
          message: "Email sudah terdaftar. Silakan Masuk.",
        };
      }
      if (/pwned|breach|compromised|weak/i.test(msg)) {
        return {
          ok: false,
          code: "weak_password",
          message:
            "Kata sandi ini pernah bocor atau terlalu lemah. Pakai kata sandi lain (min. 8 karakter, unik).",
        };
      }
      console.error("[secureSignUp] createUser failed", error);
      return {
        ok: false,
        code: "server_error",
        message: "Pendaftaran gagal: " + msg,
      };
    }

    // Tandai percobaan terakhir sebagai berhasil supaya audit log
    // (/admin/signup-attempts) mencerminkan status sebenarnya — kalau tidak,
    // semua baris tampak "Gagal" walau akun sebenarnya terbuat.
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: latest } = await supabaseAdmin
        .from("signup_attempts")
        .select("id")
        .eq("ip", ip)
        .eq("email", data.email)
        .gte("created_at", oneHourAgo)
        .order("created_at", { ascending: false })
        .limit(1);
      const latestId = Array.isArray(latest) && latest[0]?.id;
      if (latestId) {
        await supabaseAdmin
          .from("signup_attempts")
          .update({ succeeded: true })
          .eq("id", latestId);
      }
    } catch (markErr) {
      // Non-fatal: audit trail saja, jangan menggagalkan signup yang sudah sukses.
      console.warn("[secureSignUp] mark succeeded failed", markErr);
    }

    return { ok: true, userId: created.user!.id };
}

export const secureSignUp = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<SecureSignUpResult> => {
    return secureSignUpImpl(data, getRequest());
  });