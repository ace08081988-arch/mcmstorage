import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { shouldAllowTurnstileDevBypass } from "./turnstile-dev";

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
  turnstileToken: z.string().min(1).max(4096),
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

async function verifyTurnstile(token: string, ip: string, secret: string): Promise<
  { ok: true } | { ok: false; codes: string[] }
> {
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip) body.set("remoteip", ip);

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    const json = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
    };
    if (json.success) return { ok: true };
    return { ok: false, codes: json["error-codes"] ?? ["unknown"] };
  } catch {
    return { ok: false, codes: ["network_error"] };
  }
}

export const secureSignUp = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<SecureSignUpResult> => {
    const req = getRequest();
    const ip = clientIpFromRequest(req);
    const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 512) || null;

    // Baca secret dari DB dulu (agar admin bisa mengganti runtime lewat halaman
    // /admin/turnstile), fallback ke env TURNSTILE_SECRET_KEY.
    let turnstileSecret = "";
    try {
      const { supabaseAdmin: adminForSecret } = await import(
        "@/integrations/supabase/client.server"
      );
      const { data: cfg } = await adminForSecret
        .from("turnstile_config")
        .select("secret_key")
        .eq("id", 1)
        .maybeSingle();
      turnstileSecret = ((cfg?.secret_key as string | undefined) ?? "").trim();
    } catch {
      /* fall through to env */
    }
    if (!turnstileSecret) turnstileSecret = process.env.TURNSTILE_SECRET_KEY ?? "";
    if (!turnstileSecret) {
      // Kunci belum dipasang di lingkungan server — jangan izinkan pendaftaran
      // sampai admin mengatur TURNSTILE_SECRET_KEY.
      return {
        ok: false,
        code: "server_misconfigured",
        message:
          "Verifikasi manusia (Turnstile) belum diaktifkan di server. Hubungi admin.",
      };
    }

    // 1) Verifikasi Turnstile lebih dulu — biar bot tidak menghabiskan slot rate limit.
    if (!data.turnstileToken) {
      return {
        ok: false,
        code: "captcha_missing",
        message: "Verifikasi CAPTCHA belum selesai. Ulangi verifikasi lalu coba lagi.",
      };
    }
    // Dev bypass: hanya jika request datang dari IP loopback DAN server
    // tidak berjalan di mode production. Ini melindungi preview/publish dari
    // menerima token "dev-bypass" secara tidak sengaja.
    const isDevBypass = shouldAllowTurnstileDevBypass(
      ip,
      process.env.NODE_ENV,
      data.turnstileToken,
    );
    if (isDevBypass) {
      console.warn("[secureSignUp] Turnstile dev bypass aktif (localhost/dev only)");
    }
    const captcha = isDevBypass
      ? ({ ok: true } as const)
      : await verifyTurnstile(data.turnstileToken, ip, turnstileSecret);
    if (!captcha.ok) {
      const codes = captcha.codes.join(", ");
      return {
        ok: false,
        code: "captcha_failed",
        message:
          "Verifikasi CAPTCHA gagal. Muat ulang halaman lalu selesaikan verifikasi manusia (Turnstile) sebelum mendaftar. (" +
          codes +
          ")",
      };
    }

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

    // 3) Buat akun via admin API. Email dianggap terkonfirmasi mengikuti kebijakan
    // sebelumnya (auto-confirm sudah aktif di setup akun).
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { chat_only: data.chatOnly },
    });
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
  });