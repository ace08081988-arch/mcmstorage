import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { ShieldAlert, Loader2, Check, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  acknowledgeFindings,
  listSecurityFindings,
  runSecurityScanNow,
} from '@/lib/security-scan.functions'

export function SecurityFindingsBanner({ compact = false }: { compact?: boolean }) {
  const fetcher = useServerFn(listSecurityFindings)
  const runFn = useServerFn(runSecurityScanNow)
  const ackFn = useServerFn(acknowledgeFindings)
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)

  const { data } = useQuery({
    queryKey: ['security-findings'],
    queryFn: () => fetcher(),
    refetchInterval: 5 * 60 * 1000,
  })

  const runMut = useMutation({
    mutationFn: () => runFn(),
    onSettled: () => qc.invalidateQueries({ queryKey: ['security-findings'] }),
  })
  const ackMut = useMutation({
    mutationFn: (ids: string[]) => ackFn({ data: { ids } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['security-findings'] }),
  })

  if (!data?.isAdmin) return null
  const open = data.findings.filter((f) => !f.acknowledged_at)
  if (open.length === 0 && !compact) return null

  return (
    <div className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="flex-1 text-sm">
          <div className="font-medium">
            {open.length === 0
              ? 'Scan keamanan: tidak ada temuan terbuka'
              : `${open.length} temuan keamanan terbuka`}
          </div>
          {data.lastRun?.finished_at && (
            <div className="mt-0.5 text-xs text-amber-900/70 dark:text-amber-100/70">
              Scan terakhir: {new Date(data.lastRun.finished_at).toLocaleString('id-ID')} ·{' '}
              {data.lastRun.finding_count} total, {data.lastRun.new_count} baru
            </div>
          )}
          {expanded && open.length > 0 && (
            <ul className="mt-2 space-y-1.5 text-xs">
              {open.slice(0, 20).map((f) => (
                <li key={f.id} className="flex items-start gap-2 rounded border border-amber-200/60 bg-white/40 p-2 dark:border-amber-500/20 dark:bg-amber-950/30">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                      f.severity === 'critical'
                        ? 'bg-destructive text-destructive-foreground'
                        : 'bg-amber-200 text-amber-900 dark:bg-amber-700 dark:text-amber-50'
                    }`}
                  >
                    {f.severity}
                  </span>
                  <div className="flex-1">
                    <div className="font-medium">{f.title}</div>
                    <div className="font-mono text-[10px] text-amber-900/60 dark:text-amber-100/60">
                      {f.code}
                    </div>
                  </div>
                  <button
                    onClick={() => ackMut.mutate([f.id])}
                    disabled={ackMut.isPending}
                    className="inline-flex h-6 items-center gap-1 rounded border border-amber-300 px-1.5 text-[11px] hover:bg-amber-100 dark:border-amber-500/50 dark:hover:bg-amber-900/40"
                    title="Tandai sudah ditangani"
                  >
                    <Check className="h-3 w-3" /> OK
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {open.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Sembunyikan' : 'Lihat detail'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => runMut.mutate()}
              disabled={runMut.isPending}
            >
              {runMut.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
              )}
              Jalankan sekarang
            </Button>
            {open.length > 1 && expanded && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => ackMut.mutate(open.map((f) => f.id))}
                disabled={ackMut.isPending}
              >
                Tandai semua OK
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}