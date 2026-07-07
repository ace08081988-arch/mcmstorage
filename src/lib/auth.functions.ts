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
 * Mask email untuk log: "ada@contoh.com" → "a**@contoh.com". Cukup untuk
 * mengorelasikan baris log tanpa membocorkan PII di stdout Worker.
 */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local.slice(0, 1);
  return head + "*".repeat(Math.max(1, local.length - 1)) + domain;
}

/** Pesan diagnostik ringkas untuk error-code Turnstile — dipakai admin
 * saat baca log agar tidak harus buka dokumentasi Cloudflare. */
const TURNSTILE_HINTS: Record<string, string> = {
  "missing-input-secret": "Server tidak mengirim secret.",
  "invalid-input-secret":
    "Secret key salah/tidak dikenal — periksa /admin/turnstile.",
  "missing-input-response": "Token dari client kosong.",
  "invalid-input-response":
    "Token dari client tidak valid atau kedaluwarsa.",
  "bad-request": "Request malformed ke Cloudflare.",
  "timeout-or-duplicate":
    "Token sudah dipakai/kedaluwarsa (>5 menit sejak diterbitkan).",
  "internal-error": "Sisi Cloudflare bermasalah — coba lagi.",
  "invalid-hostname":
    "Hostname request belum di-allowlist di widget Turnstile.",
};

export type TurnstileVerifyResult =
  | { ok: true; hostname?: string; action?: string; challengeTs?: string }
  | {
      ok: false;
      codes: string[];
      httpStatus?: number;
      hostname?: string;
      action?: string;
      challengeTs?: string;
      durationMs: number;
    };

async function verifyTurnstile(
  token: string,
  ip: string,
  secret: string,
  ctx: { email: string; userAgent: string | null; secretSource: string },
): Promise<TurnstileVerifyResult> {
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip) body.set("remoteip", ip);

  const startedAt = Date.now();
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    const durationMs = Date.now() - startedAt;
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      "error-codes"?: string[];
      hostname?: string;
      action?: string;
      challenge_ts?: string;
      messages?: string[];
    };
    const codes = json["error-codes"] ?? [];
    if (json.success) {
      // Log ringkas untuk keperluan telemetri — level info supaya bisa
      // difilter dari kegagalan.
      console.info(
        "[turnstile.verify] ok",
        JSON.stringify({
          ip,
          email: maskEmail(ctx.email),
          hostname: json.hostname ?? null,
          action: json.action ?? null,
          challenge_ts: json.challenge_ts ?? null,
          secret_source: ctx.secretSource,
          duration_ms: durationMs,
          http_status: res.status,
        }),
      );
      return {
        ok: true,
        hostname: json.hostname,
        action: json.action,
        challengeTs: json.challenge_ts,
      };
    }
    const hints = codes
      .map((c) => TURNSTILE_HINTS[c])
      .filter((v): v is string => Boolean(v));
    console.error(
      "[turnstile.verify] failed",
      JSON.stringify({
        ip,
        email: maskEmail(ctx.email),
        error_codes: codes.length ? codes : ["unknown"],
        hint: hints.join(" ") || null,
        hostname: json.hostname ?? null,
        action: json.action ?? null,
        challenge_ts: json.challenge_ts ?? null,
        messages: json.messages ?? null,
        secret_source: ctx.secretSource,
        duration_ms: durationMs,
        http_status: res.status,
        user_agent: ctx.userAgent,
      }),
    );
    return {
      ok: false,
      codes: codes.length ? codes : ["unknown"],
      httpStatus: res.status,
      hostname: json.hostname,
      action: json.action,
      challengeTs: json.challenge_ts,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    console.error(
      "[turnstile.verify] network_error",
      JSON.stringify({
        ip,
        email: maskEmail(ctx.email),
        error: err instanceof Error ? err.message : String(err),
        secret_source: ctx.secretSource,
        duration_ms: durationMs,
      }),
    );
    return { ok: false, codes: ["network_error"], durationMs };
  }
}

/**
 * Catat percobaan pendaftaran yang gagal SEBELUM mencapai rate-limit RPC
 * (mis. captcha_missing / captcha_failed). Non-fatal: kegagalan logging tidak
 * boleh mengganggu jalur error yang dilihat pengguna.
 */
async function logCaptchaFailureAttempt(
  ip: string,
  email: string,
  userAgent: string | null,
  code: "captcha_missing" | "captcha_failed",
  details: string | null,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("signup_attempts").insert({
      ip,
      email,
      user_agent: userAgent,
      succeeded: false,
      // Kolom baru — cast agar type-check lulus sebelum types.ts diregenerasi.
      ...({ failure_code: code, failure_details: details } as Record<string, unknown>),
    } as never);
  } catch (err) {
    console.warn("[secureSignUp] gagal mencatat kegagalan captcha", err);
  }
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