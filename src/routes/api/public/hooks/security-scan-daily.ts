import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual, createHash } from 'crypto'

type Finding = {
  id: string
  code: string
  severity: string
  title: string
  detail: Record<string, unknown>
  first_seen_at: string
}

export const Route = createFileRoute('/api/public/hooks/security-scan-daily')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        const hookSecret = process.env.SECURITY_SCAN_HOOK_SECRET
        const slackUrl = process.env.SLACK_SECURITY_WEBHOOK_URL
        const lovableApiKey = process.env.LOVABLE_API_KEY
        const senderDomain = process.env.SENDER_DOMAIN ?? 'notify.mcmstorage.biz'
        const lovableSendUrl = process.env.LOVABLE_SEND_URL

        const ip =
          request.headers.get('cf-connecting-ip') ??
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
          null
        const userAgent = request.headers.get('user-agent')
        const presentedAuthRaw =
          request.headers.get('x-hook-secret') ??
          request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ??
          request.headers.get('apikey')

        const auditFailure = async (reason: string) => {
          // Selalu coba catat ke console agar terlihat di log worker
          // walaupun DB insert gagal (mis. config_missing).
          console.warn('[security-scan-daily] auth_failed', {
            reason,
            ip,
            userAgent,
            hasAuthHeader: Boolean(presentedAuthRaw),
          })
          if (!supabaseUrl || !serviceKey) return
          try {
            const adminClient = createClient(supabaseUrl, serviceKey, {
              auth: { persistSession: false, autoRefreshToken: false },
            })
            await adminClient.from('security_hook_audit').insert({
              hook_name: 'security-scan-daily',
              reason,
              ip,
              user_agent: userAgent,
              presented_auth_hash: presentedAuthRaw
                ? createHash('sha256').update(presentedAuthRaw).digest('hex')
                : null,
              headers: {
                has_x_hook_secret: Boolean(request.headers.get('x-hook-secret')),
                has_authorization: Boolean(request.headers.get('Authorization')),
                has_apikey: Boolean(request.headers.get('apikey')),
              },
            })
          } catch (e) {
            console.error('[security-scan-daily] audit_insert_failed', e)
          }
        }

        if (!supabaseUrl || !serviceKey) {
          await auditFailure('config_missing')
          return Response.json({ error: 'config_missing' }, { status: 500 })
        }
        const supabase = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })

        // Auth: shared-secret privat. Anon/publishable key TIDAK boleh dipakai
        // karena ter-bundle ke klien dan bisa diambil siapa saja. Cron harian
        // memakai secret yang tersimpan di DB backend; env secret tetap diterima
        // agar rotasi/rollback tidak memutus pemanggil tepercaya.
        if (!presentedAuthRaw) {
          await auditFailure('missing_secret')
          return new Response('Unauthorized', { status: 401 })
        }
        const { data: storedSecretRow, error: storedSecretError } = await supabase
          .from('security_scan_hook_secrets')
          .select('hook_secret')
          .eq('hook_name', 'security-scan-daily')
          .maybeSingle()
        if (storedSecretError) {
          await auditFailure('stored_secret_lookup_failed')
          return Response.json({ error: 'stored_secret_lookup_failed' }, { status: 500 })
        }
        const validSecrets = [hookSecret, storedSecretRow?.hook_secret]
          .filter((s): s is string => Boolean(s))
        if (validSecrets.length === 0) {
          await auditFailure('hook_secret_not_configured')
          return Response.json({ error: 'hook_secret_not_configured' }, { status: 500 })
        }
        const presented = Buffer.from(presentedAuthRaw)
        const matched = validSecrets.some((secret) => {
          const expected = Buffer.from(secret)
          return presented.length === expected.length && timingSafeEqual(presented, expected)
        })
        if (!matched) {
          await auditFailure('wrong_secret')
          return new Response('Unauthorized', { status: 401 })
        }

        // 1. Jalankan scan
        const { data: scan, error: scanErr } = await supabase.rpc('run_internal_security_scan')
        if (scanErr) {
          return Response.json({ error: 'scan_failed', detail: scanErr.message }, { status: 500 })
        }

        // 2. Ambil temuan yang belum dinotifikasi (terbuka)
        const { data: pending } = await supabase
          .from('security_scan_findings')
          .select('id, code, severity, title, detail, first_seen_at')
          .is('notified_at', null)
          .is('resolved_at', null)
          .order('severity', { ascending: false })
          .limit(50)

        const findings = (pending ?? []) as Finding[]
        const channels: Record<string, unknown> = {
          push: { sent: 0, error: null as string | null },
          slack: { sent: false, error: null as string | null, skipped: !slackUrl },
          email: { sent: false, error: null as string | null, skipped: false as boolean | string },
        }

        if (findings.length > 0) {
          const summary =
            findings
              .slice(0, 5)
              .map((f) => `• [${f.severity.toUpperCase()}] ${f.title}`)
              .join('\n') + (findings.length > 5 ? `\n…dan ${findings.length - 5} lainnya` : '')

          // ---- Push ke admin
          try {
            const { data: admins } = await supabase
              .from('user_roles')
              .select('user_id')
              .eq('role', 'admin')
            const adminIds = (admins ?? []).map((a) => a.user_id as string)
            if (adminIds.length > 0) {
              const { notifyUsers } = await import('@/lib/push.server')
              const r = await notifyUsers({
                userIds: adminIds,
                payload: {
                  title: `${findings.length} temuan keamanan baru`,
                  body: findings[0].title,
                  url: '/audit',
                  tag: 'security-scan',
                },
              })
              channels.push = { sent: r.sent, pruned: r.pruned, admins: adminIds.length }
            } else {
              channels.push = { sent: 0, error: 'no_admin_users' }
            }
          } catch (e) {
            channels.push = { sent: 0, error: e instanceof Error ? e.message : String(e) }
          }

          // ---- Slack/Discord webhook
          if (slackUrl) {
            try {
              const isDiscord = /discord(app)?\.com\/api\/webhooks\//i.test(slackUrl)
              const text = `🛡️ *MCM Storage — Scan Keamanan Harian*\nDitemukan ${findings.length} temuan terbuka:\n${summary}`
              const body = isDiscord ? { content: text } : { text }
              const res = await fetch(slackUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              })
              channels.slack = res.ok
                ? { sent: true }
                : { sent: false, error: `http_${res.status}` }
            } catch (e) {
              channels.slack = { sent: false, error: e instanceof Error ? e.message : String(e) }
            }
          }

          // ---- Email ke admin (pakai email_monitor_config.admin_email)
          try {
            const { data: cfg } = await supabase
              .from('email_monitor_config')
              .select('admin_email')
              .eq('id', 1)
              .maybeSingle()
            const to = cfg?.admin_email as string | undefined
            if (!to) {
              channels.email = { sent: false, skipped: 'no_admin_email' }
            } else if (!lovableApiKey) {
              channels.email = { sent: false, skipped: 'no_lovable_api_key' }
            } else {
              const { sendLovableEmail } = await import('@lovable.dev/email-js')
              const list = findings
                .map(
                  (f) =>
                    `<li><strong>[${f.severity}]</strong> ${f.title} <code style="color:#888">${f.code}</code></li>`,
                )
                .join('')
              await sendLovableEmail(
                {
                  to,
                  from: `alerts@${senderDomain}`,
                  sender_domain: senderDomain,
                  subject: `[Keamanan] ${findings.length} temuan baru pada scan harian`,
                  html: `<h2>Scan keamanan harian</h2><p>Ditemukan ${findings.length} temuan terbuka:</p><ul>${list}</ul><p style="color:#888;font-size:12px">Buka aplikasi → Audit untuk detail. Dikirim ${new Date().toISOString()}</p>`,
                  text: `Scan keamanan harian: ${findings.length} temuan.\n${summary}`,
                  purpose: 'transactional',
                  label: 'security-scan-alert',
                  idempotency_key: `secscan-${(scan as { run_id?: string })?.run_id ?? Date.now()}`,
                  message_id: `secscan-${Date.now()}`,
                },
                { apiKey: lovableApiKey, sendUrl: lovableSendUrl },
              )
              // Jangan bocorkan alamat email admin di response.
              channels.email = { sent: true }
            }
          } catch (e) {
            channels.email = { sent: false, error: e instanceof Error ? e.message : String(e) }
          }

          // 3. Tandai notified_at agar tidak dikirim ulang
          await supabase
            .from('security_scan_findings')
            .update({ notified_at: new Date().toISOString() })
            .in(
              'id',
              findings.map((f) => f.id),
            )
        }

        return Response.json({ ok: true, scan, notified: findings.length, channels })
      },
    },
  },
})