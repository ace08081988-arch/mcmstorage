import { createServerFn } from '@tanstack/react-start'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'
import { createHash, randomInt, randomUUID } from 'crypto'

export type EmailQueueHealth = {
  pending_auth: number
  pending_transactional: number
  dlq_auth: number
  dlq_transactional: number
  sent_last_30m: number
  failed_last_30m: number
  last_sent_at: string | null
}

export type RecentOtpRow = {
  id: string
  message_id: string | null
  recipient_email: string
  status: string
  error_message: string | null
  created_at: string
}

export type EmailQueueStatus = {
  isAdmin: boolean
  fetchedAt: string
  health: EmailQueueHealth | null
  cronProcessLastRun: string | null
  cronProcessNextRun: string | null
  recentOtp: RecentOtpRow[]
}

/**
 * Pure builder untuk `getEmailQueueStatus`. Diekspor supaya kontrak
 * non-admin (harus return `{isAdmin:false,…}` — TIDAK throw
 * "Forbidden: admin diperlukan") bisa diuji tanpa middleware/HTTP.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildEmailQueueStatus(context: any): Promise<EmailQueueStatus> {
  const { supabase, userId } = context
  const { data: isAdmin } = await supabase.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  })
  const now = new Date().toISOString()
  if (!isAdmin) {
    return {
      isAdmin: false,
      fetchedAt: now,
      health: null,
      cronProcessLastRun: null,
      cronProcessNextRun: null,
      recentOtp: [],
    }
  }
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
  const [{ data: healthData }, { data: otpRows }] = await Promise.all([
    supabaseAdmin.rpc('email_queue_health'),
    supabaseAdmin
      .from('email_send_log')
      .select('id, message_id, recipient_email, status, error_message, created_at')
      .eq('template_name', 'device_otp')
      .order('created_at', { ascending: false })
      .limit(25),
  ])
  return {
    isAdmin: true,
    fetchedAt: now,
    health: (healthData ?? null) as EmailQueueHealth | null,
    cronProcessLastRun: null,
    cronProcessNextRun: null,
    recentOtp: (otpRows ?? []) as RecentOtpRow[],
  }
}

export const getEmailQueueStatus = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EmailQueueStatus> => {
    return buildEmailQueueStatus(context)
  })

const SENDER_DOMAIN = 'notify.mcmstorage.biz'
const FROM_ADDRESS = `MCM Storage <noreply@${SENDER_DOMAIN}>`
const OTP_TTL_MS = 10 * 60 * 1000

function hashCode(code: string, salt: string) {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex')
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

function renderOtpEmail(code: string, ip: string, ua: string) {
  return `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a;background:#f8fafc;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
    <h1 style="font-size:18px;margin:0 0 8px">Verifikasi device baru</h1>
    <p style="font-size:14px;color:#475569;margin:0 0 16px">
      Kode verifikasi baru (resend admin) untuk login MCM Storage Anda.
    </p>
    <div style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0">
      ${code}
    </div>
    <p style="font-size:12px;color:#64748b;margin:8px 0">Berlaku 10 menit. Maksimal 5 percobaan.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
    <p style="font-size:11px;color:#64748b;margin:0">Konteks permintaan terakhir:</p>
    <p style="font-size:11px;color:#64748b;margin:4px 0"><strong>IP:</strong> ${escapeHtml(ip)}</p>
    <p style="font-size:11px;color:#64748b;margin:4px 0"><strong>Device:</strong> ${escapeHtml(ua)}</p>
  </div>
</body></html>`
}

export type ResendOtpResult =
  | { ok: true; messageId: string; recipient: string }
  | { ok: false; error: string }

export const resendDeviceOtpByMessage = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { messageId: string }) => {
    if (!data?.messageId || typeof data.messageId !== 'string') {
      throw new Error('messageId tidak valid')
    }
    return { messageId: data.messageId }
  })
  .handler(async ({ data, context }): Promise<ResendOtpResult> => {
    const { supabase, userId } = context
    const { data: isAdmin } = await supabase.rpc('has_role', {
      _user_id: userId,
      _role: 'admin',
    })
    if (!isAdmin) return { ok: false, error: 'Bukan admin' }

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server')

    // Lookup challenge by previous message id
    const { data: challenge } = await supabaseAdmin
      .from('device_otp_challenges')
      .select('id, user_id, last_ip, last_user_agent, consumed_at')
      .eq('otp_message_id' as never, data.messageId)
      .maybeSingle()

    if (!challenge) {
      return { ok: false, error: 'Tantangan OTP tidak ditemukan untuk message ini' }
    }
    if (challenge.consumed_at) {
      return { ok: false, error: 'OTP sudah dipakai/diverifikasi — tidak perlu resend' }
    }

    // Resolve recipient email
    const { data: userResp } = await supabaseAdmin.auth.admin.getUserById(challenge.user_id)
    const email = userResp?.user?.email
    if (!email) return { ok: false, error: 'Email penerima tidak ditemukan' }

    // Generate new code, reset attempts, extend expiry
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const code_hash = hashCode(code, challenge.id)
    const newMessageId = randomUUID()
    const idempotencyKey = `device-otp-${challenge.id}-resend-${Date.now()}`

    const { error: updErr } = await supabaseAdmin
      .from('device_otp_challenges')
      .update({
        code_hash,
        attempts: 0,
        expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
        otp_message_id: newMessageId,
      } as never)
      .eq('id', challenge.id)
    if (updErr) return { ok: false, error: `Gagal update challenge: ${updErr.message}` }

    // Ensure unsubscribe token
    let unsubscribeToken: string | null = null
    const { data: existingTok } = await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', email)
      .is('used_at', null)
      .limit(1)
      .maybeSingle()
    if (existingTok?.token) {
      unsubscribeToken = existingTok.token
    } else {
      const newTok = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
      const { data: inserted } = await supabaseAdmin
        .from('email_unsubscribe_tokens')
        .insert({ email, token: newTok })
        .select('token')
        .single()
      unsubscribeToken = inserted?.token ?? null
    }

    const ip = challenge.last_ip || 'unknown'
    const ua = challenge.last_user_agent || 'unknown'
    const subject = 'Kode verifikasi device (resend) — MCM Storage'
    const html = renderOtpEmail(code, ip, ua)
    const text = `Kode verifikasi device MCM Storage Anda (resend): ${code}\nBerlaku 10 menit.`

    const { error: rpcErr } = await supabaseAdmin.rpc('enqueue_email' as never, {
      queue_name: 'transactional_emails',
      payload: {
        to: email,
        from: FROM_ADDRESS,
        sender_domain: SENDER_DOMAIN,
        subject,
        html,
        text,
        purpose: 'transactional',
        label: 'device_otp',
        idempotency_key: idempotencyKey,
        message_id: newMessageId,
        queued_at: new Date().toISOString(),
        unsubscribe_token: unsubscribeToken,
      },
    } as never)
    if (rpcErr) return { ok: false, error: `Enqueue gagal: ${rpcErr.message}` }

    return { ok: true, messageId: newMessageId, recipient: email }
  })