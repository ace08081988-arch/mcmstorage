import { createServerFn } from '@tanstack/react-start'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

export type SecurityFinding = {
  id: string
  code: string
  severity: string
  title: string
  detail: unknown
  first_seen_at: string
  last_seen_at: string
  acknowledged_at: string | null
  notified_at: string | null
}

export const listSecurityFindings = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context
    const { data: isAdmin } = await supabase.rpc('has_role', {
      _user_id: userId,
      _role: 'admin',
    })
    if (!isAdmin) {
      return { isAdmin: false, findings: [] as SecurityFinding[], openCount: 0, lastRun: null }
    }
    const { data: findings } = await supabase
      .from('security_scan_findings')
      .select(
        'id, code, severity, title, detail, first_seen_at, last_seen_at, acknowledged_at, notified_at',
      )
      .is('resolved_at', null)
      .order('severity', { ascending: false })
      .order('last_seen_at', { ascending: false })
      .limit(200)
    const { data: lastRun } = await supabase
      .from('security_scan_runs')
      .select('id, started_at, finished_at, finding_count, new_count, resolved_count, status')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const list = (findings ?? []) as SecurityFinding[]
    return {
      isAdmin: true,
      findings: list,
      openCount: list.filter((f) => !f.acknowledged_at).length,
      lastRun: lastRun ?? null,
    }
  })

export const runSecurityScanNow = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context
    const { data: isAdmin } = await supabase.rpc('has_role', {
      _user_id: userId,
      _role: 'admin',
    })
    if (!isAdmin) throw new Error('Forbidden')
    const { data, error } = await supabase.rpc('run_internal_security_scan')
    if (error) throw new Error(error.message)
    return data as { ok: boolean; run_id: string; total: number; new: number; resolved: number }
  })

export const acknowledgeFindings = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids: string[] }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context
    const { data: count, error } = await supabase.rpc('security_findings_acknowledge', {
      _ids: data.ids,
    })
    if (error) throw new Error(error.message)
    return { count: count as number }
  })