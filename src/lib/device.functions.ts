import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "crypto";

const SENDER_DOMAIN = "notify.mcmstorage.biz";
const FROM_ADDRESS = `MCM Storage <noreply@${SENDER_DOMAIN}>`;

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function clientIp() {
  const candidates = [
    getRequestHeader("cf-connecting-ip"),
    getRequestHeader("x-forwarded-for"),
    getRequestHeader("x-real-ip"),
  ];
  for (const c of candidates) {
    if (c) return c.split(",")[0].trim();
  }
  return "unknown";
}

function hashCode(code: string, salt: string) {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function combinedHash(deviceHash: string, ip: string) {
  return createHash("sha256").update(`${deviceHash}|${ip}`).digest("hex");
}

export const requestDeviceOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { deviceHash: string }) => {
    if (!data?.deviceHash || typeof data.deviceHash !== "string" || data.deviceHash.length < 16) {
      throw new Error("deviceHash tidak valid");
    }
    return { deviceHash: data.deviceHash };
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const ip = clientIp();
    const ua = getRequestHeader("user-agent") || "unknown";
    const fullHash = combinedHash(data.deviceHash, ip);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Sudah pernah trusted?
    const { data: existing } = await supabaseAdmin
      .from("user_devices")
      .select("id, trusted_at")
      .eq("user_id", userId)
      .eq("device_hash", fullHash)
      .maybeSingle();

    if (existing?.trusted_at) {
      await supabaseAdmin
        .from("user_devices")
        .update({
          last_ip: ip,
          last_user_agent: ua,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      return { trusted: true as const };
    }

    // Generate OTP 6 digit
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const { data: challenge, error: chErr } = await supabaseAdmin
      .from("device_otp_challenges")
      .insert({
        user_id: userId,
        device_hash: fullHash,
        code_hash: "pending",
        expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
        last_ip: ip,
        last_user_agent: ua,
      })
      .select("id")
      .single();
    if (chErr || !challenge) throw new Error("Gagal membuat tantangan OTP");

    const code_hash = hashCode(code, challenge.id);
    await supabaseAdmin
      .from("device_otp_challenges")
      .update({ code_hash })
      .eq("id", challenge.id);

    // Ambil email user
    const { data: userResp } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = userResp?.user?.email;
    if (!email) throw new Error("Email akun tidak ditemukan");

    const subject = "Kode verifikasi device — MCM Storage";
    const html = renderOtpEmail(code, ip, ua);
    const text = `Kode verifikasi device MCM Storage Anda: ${code}\nBerlaku 10 menit.\nIP: ${ip}\nDevice: ${ua}\nJika bukan Anda, segera ganti kata sandi.`;

    let emailSent = false;
    let emailError: string | null = null;
    try {
      const messageId = randomUUID();
      const idempotencyKey = `device-otp-${challenge.id}`;
      const { error: rpcErr } = await supabaseAdmin.rpc("enqueue_email" as never, {
        queue_name: "transactional_emails",
        payload: {
          to: email,
          from: FROM_ADDRESS,
          sender_domain: SENDER_DOMAIN,
          subject,
          html,
          text,
          purpose: "transactional",
          label: "device_otp",
          idempotency_key: idempotencyKey,
          message_id: messageId,
          queued_at: new Date().toISOString(),
        },
      } as never);
      if (rpcErr) emailError = rpcErr.message;
      else emailSent = true;
    } catch (e) {
      emailError = e instanceof Error ? e.message : "unknown";
    }

    if (!emailSent) {
      console.error("[device-otp] gagal kirim email:", emailError);
    }

    return {
      trusted: false as const,
      challengeId: challenge.id,
      emailSent,
      maskedEmail: maskEmail(email),
    };
  });

export const verifyDeviceOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { challengeId: string; code: string; deviceHash: string }) => {
    if (!data?.challengeId || !data?.code || !data?.deviceHash) {
      throw new Error("Input tidak lengkap");
    }
    const code = String(data.code).replace(/\D/g, "");
    if (code.length !== 6) throw new Error("Kode harus 6 digit");
    return { challengeId: data.challengeId, code, deviceHash: data.deviceHash };
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const ip = clientIp();
    const ua = getRequestHeader("user-agent") || "unknown";
    const fullHash = combinedHash(data.deviceHash, ip);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ch } = await supabaseAdmin
      .from("device_otp_challenges")
      .select("id, user_id, device_hash, code_hash, attempts, expires_at, consumed_at")
      .eq("id", data.challengeId)
      .maybeSingle();

    if (!ch || ch.user_id !== userId) throw new Error("Tantangan tidak ditemukan");
    if (ch.consumed_at) throw new Error("Kode sudah dipakai");
    if (new Date(ch.expires_at).getTime() < Date.now()) throw new Error("Kode kedaluwarsa");
    if (ch.attempts >= MAX_ATTEMPTS) throw new Error("Terlalu banyak percobaan");
    if (ch.device_hash !== fullHash) {
      // Jaringan/IP berubah sejak request — minta kirim ulang
      throw new Error("Konteks device berubah, minta kode baru");
    }

    const expected = hashCode(data.code, ch.id);
    const ok =
      expected.length === ch.code_hash.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(ch.code_hash));

    if (!ok) {
      await supabaseAdmin
        .from("device_otp_challenges")
        .update({ attempts: ch.attempts + 1 })
        .eq("id", ch.id);
      throw new Error("Kode salah");
    }

    await supabaseAdmin
      .from("device_otp_challenges")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", ch.id);

    // Upsert device trusted
    await supabaseAdmin.from("user_devices").upsert(
      {
        user_id: userId,
        device_hash: fullHash,
        last_ip: ip,
        last_user_agent: ua,
        trusted_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "user_id,device_hash" },
    );

    return { ok: true as const };
  });

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
}

function renderOtpEmail(code: string, ip: string, ua: string) {
  return `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a;background:#f8fafc;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
    <h1 style="font-size:18px;margin:0 0 8px">Verifikasi device baru</h1>
    <p style="font-size:14px;color:#475569;margin:0 0 16px">
      Ada permintaan masuk MCM Storage dari device baru. Masukkan kode berikut untuk melanjutkan.
    </p>
    <div style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0">
      ${code}
    </div>
    <p style="font-size:12px;color:#64748b;margin:8px 0">Berlaku 10 menit. Maksimal 5 percobaan.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
    <p style="font-size:11px;color:#64748b;margin:0">Konteks permintaan:</p>
    <p style="font-size:11px;color:#64748b;margin:4px 0"><strong>IP:</strong> ${ip}</p>
    <p style="font-size:11px;color:#64748b;margin:4px 0"><strong>Device:</strong> ${escapeHtml(ua)}</p>
    <p style="font-size:12px;color:#b91c1c;margin:12px 0 0">Jika bukan Anda, segera ganti kata sandi.</p>
  </div>
</body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}