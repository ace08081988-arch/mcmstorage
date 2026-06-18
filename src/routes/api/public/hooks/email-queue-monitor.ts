import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'
import { sendLovableEmail } from '@lovable.dev/email-js'

export const Route = createFileRoute('/api/public/hooks/email-queue-monitor')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY

        const auth = request.headers.get('apikey') ?? request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
        if (!anonKey || !auth || auth !== anonKey) {
          return new Response('Unauthorized', { status: 401 })
        }
        if (!apiKey || !supabaseUrl || !serviceKey) {
          return Response.json({ error: 'config_missing' }, { status: 500 })
        }

        const supabase = createClient(supabaseUrl, serviceKey)

        const { data: config, error: cfgErr } = await supabase
          .from('email_monitor_config')
          .select('*')
          .eq('id', 1)
          .single()
        if (cfgErr || !config) {
          return Response.json({ error: 'no_config', detail: cfgErr?.message }, { status: 500 })
        }
        if (!config.enabled) {
          return Response.json({ skipped: true, reason: 'disabled' })
        }

        const { data: health, error: healthErr } = await supabase.rpc('email_queue_health')
        if (healthErr || !health) {
          return Response.json({ error: 'health_failed', detail: healthErr?.message }, { status: 500 })
        }

        const h = health as Record<string, any>
        const now = Date.now()
        const staleMin = config.stale_threshold_minutes
        const cooldownMs = config.cooldown_minutes * 60_000
        const lastSentAt = h.last_sent_at ? new Date(h.last_sent_at).getTime() : 0
        const minutesSinceSent = lastSentAt ? Math.round((now - lastSentAt) / 60_000) : null
        const pendingTotal = (h.pending_transactional ?? 0) + (h.pending_auth ?? 0)

        const alerts: { type: string; message: string; metadata: any }[] = []

        // Stale: ada pending tapi tidak ada sukses sejak X menit
        if (pendingTotal > 0 && (minutesSinceSent === null || minutesSinceSent >= staleMin)) {
          const lastAt = config.last_stale_alert_at ? new Date(config.last_stale_alert_at).getTime() : 0
          if (now - lastAt >= cooldownMs) {
            alerts.push({
              type: 'queue_stale',
              message: `Cron antrian email tidak memproses record. ${pendingTotal} pesan menunggu, terakhir sukses ${minutesSinceSent === null ? 'belum pernah' : `${minutesSinceSent} menit lalu`}.`,
              metadata: { pendingTotal, minutesSinceSent, threshold: staleMin, health: h },
            })
          }
        }

        // Error rate: failed / (sent+failed) > threshold
        const sample = (h.sent_last_30m ?? 0) + (h.failed_last_30m ?? 0)
        const rate = sample > 0 ? (h.failed_last_30m ?? 0) / sample : 0
        if (sample >= config.error_min_sample && rate >= Number(config.error_rate_threshold)) {
          const lastAt = config.last_error_alert_at ? new Date(config.last_error_alert_at).getTime() : 0
          if (now - lastAt >= cooldownMs) {
            alerts.push({
              type: 'error_spike',
              message: `Tingkat error API email tinggi: ${Math.round(rate * 100)}% (${h.failed_last_30m}/${sample}) dalam 30 menit terakhir.`,
              metadata: { rate, sample, failed: h.failed_last_30m, sent: h.sent_last_30m, health: h },
            })
          }
        }

        const fired: any[] = []
        for (const a of alerts) {
          let delivery: { status: string; error?: string } = { status: 'pending' }
          try {
            await sendLovableEmail(
              {
                to: config.admin_email,
                from: `alerts@${process.env.SENDER_DOMAIN ?? 'notify.mcmstorage.biz'}`,
                sender_domain: process.env.SENDER_DOMAIN ?? 'notify.mcmstorage.biz',
                subject: `[ALERT] ${a.type === 'queue_stale' ? 'Antrian email macet' : 'Lonjakan error email'}`,
                html: `<h2>Peringatan sistem email</h2><p>${a.message}</p><pre style="background:#f5f5f5;padding:12px;border-radius:6px;font-size:12px">${JSON.stringify(a.metadata, null, 2)}</pre><p style="color:#888;font-size:12px">Dikirim oleh email-queue-monitor • ${new Date().toISOString()}</p>`,
                text: a.message,
                purpose: 'transactional',
                label: 'email-queue-alert',
                idempotency_key: `alert-${a.type}-${Math.floor(now / cooldownMs)}`,
                message_id: `alert-${a.type}-${now}`,
              },
              { apiKey, sendUrl: process.env.LOVABLE_SEND_URL }
            )
            delivery = { status: 'sent' }
          } catch (e) {
            delivery = { status: 'failed', error: e instanceof Error ? e.message : String(e) }
          }

          await supabase.from('email_queue_alerts').insert({
            alert_type: a.type,
            severity: a.type === 'queue_stale' ? 'critical' : 'warning',
            message: a.message,
            metadata: a.metadata,
            notified_email: config.admin_email,
            delivery_status: delivery.status,
            delivery_error: delivery.error ?? null,
          })

          const patch: Record<string, string> = { last_check_at: new Date().toISOString() }
          if (a.type === 'queue_stale') patch.last_stale_alert_at = new Date().toISOString()
          if (a.type === 'error_spike') patch.last_error_alert_at = new Date().toISOString()
          await supabase.from('email_monitor_config').update(patch).eq('id', 1)

          fired.push({ type: a.type, delivery })
        }

        if (alerts.length === 0) {
          await supabase.from('email_monitor_config').update({ last_check_at: new Date().toISOString() }).eq('id', 1)
        }

        return Response.json({ ok: true, health: h, fired })
      },
    },
  },
})