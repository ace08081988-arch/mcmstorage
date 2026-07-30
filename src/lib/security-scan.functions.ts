import { createServerFn } from '@tanstack/react-start'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'
import { logAdminDenial } from './admin-denial-telemetry'

export type SecurityFinding = {
  id: string
  code: string
  severity: string
  title: string
  detail: string
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
      logAdminDenial({ fn: 'security-scan:listSecurityFindings', userId })
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
    const list: SecurityFinding[] = (findings ?? []).map((f) => ({
      id: f.id as string,
      code: f.code as string,
      severity: f.severity as string,
      title: f.title as string,
      detail: JSON.stringify(f.detail ?? {}),
      first_seen_at: f.first_seen_at as string,
      last_seen_at: f.last_seen_at as string,
      acknowledged_at: (f.acknowledged_at as string | null) ?? null,
      notified_at: (f.notified_at as string | null) ?? null,
    }))
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
    if (!isAdmin) {
      logAdminDenial({ fn: 'security-scan:runSecurityScanNow', userId })
      throw new Error('Forbidden')
    }
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