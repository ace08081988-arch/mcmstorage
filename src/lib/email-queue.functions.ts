import { createServerFn } from '@tanstack/react-start'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

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

export const getEmailQueueStatus = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EmailQueueStatus> => {
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
  })