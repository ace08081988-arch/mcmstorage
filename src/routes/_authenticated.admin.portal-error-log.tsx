import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, RefreshCw, ShieldAlert, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  listPortalErrorLog,
  acknowledgePortalErrorAlert,
} from "@/lib/portal-error-log.functions";
import { useAdminStatus } from "@/hooks/use-is-admin";

export const Route = createFileRoute("/_authenticated/admin/portal-error-log")({
  head: () => ({
    meta: [
      { title: "Log Error Portal Publik · MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PortalErrorLogPage,
});

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("id-ID", { hour12: false });
  } catch {
    return iso;
  }
}

function PortalErrorLogPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const fetchLog = useServerFn(listPortalErrorLog);
  const ackAlert = useServerFn(acknowledgePortalErrorAlert);
  const qc = useQueryClient();
  const [kindFilter, setKindFilter] = useState<string>("");

  const q = useQuery({
    queryKey: ["portal-error-log", { kind: kindFilter }],
    queryFn: () => fetchLog({ data: { limit: 200, kind: kindFilter || null } }),
    enabled: isAdmin === true,
    refetchInterval: 30_000,
  });

  if (isCheckingAdmin) {
    return <div className="p-ms-4 text-ms-sm text-muted-foreground">Memeriksa akses…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg p-ms-6 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-destructive" />
        <h1 className="mt-2 text-ms-lg font-semibold">Akses ditolak</h1>
        <p className="text-ms-sm text-muted-foreground">
          Halaman ini hanya untuk admin.
        </p>
        <Link to="/" className="mt-3 inline-block text-ms-sm underline">Kembali</Link>
      </div>
    );
  }

  const data = q.data;
  const alerts = data?.alerts ?? [];
  const events = data?.events ?? [];
  const totals = data?.totals;

  async function onAck(id: string) {
    const r = await ackAlert({ data: { id } });
    if (r.ok) {
      toast.success("Alert ditandai selesai");
      void qc.invalidateQueries({ queryKey: ["portal-error-log"] });
    } else {
      toast.error("Gagal: " + (r.error ?? "unknown"));
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-ms-4 p-ms-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-ms-2">
          <Link to="/" className="text-ms-sm text-muted-foreground hover:underline">
            <ChevronLeft className="mr-1 inline h-4 w-4" />
            Kembali
          </Link>
          <h1 className="text-ms-lg font-semibold">Log Error Portal Publik</h1>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          <RefreshCw className={"mr-1 h-3.5 w-3.5 " + (q.isFetching ? "animate-spin" : "")} />
          Muat ulang
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-ms-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-ms-xs uppercase text-muted-foreground">Event 24 jam</CardTitle></CardHeader>
          <CardContent className="text-ms-2xl font-bold">{totals?.events24h ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-ms-xs uppercase text-muted-foreground">Alert terbuka</CardTitle></CardHeader>
          <CardContent className="text-ms-2xl font-bold text-destructive">{totals?.openAlerts ?? 0}</CardContent>
        </Card>
        <Card className="col-span-2 md:col-span-1">
          <CardHeader className="pb-1"><CardTitle className="text-ms-xs uppercase text-muted-foreground">Top kind (24 jam)</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-ms-xs">
            {(totals?.byKind ?? []).slice(0, 5).map((k) => (
              <button
                key={k.kind}
                type="button"
                className="mr-1 rounded border px-ms-2 py-0.5 hover:bg-muted"
                onClick={() => setKindFilter(k.kind === kindFilter ? "" : k.kind)}
              >
                {k.kind} <span className="text-muted-foreground">×{k.count}</span>
              </button>
            ))}
            {(totals?.byKind ?? []).length === 0 && <span className="text-muted-foreground">Tidak ada</span>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-ms-sm flex items-center gap-ms-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Alert (error berulang)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-ms-2">
          {alerts.length === 0 && (
            <div className="text-ms-xs text-muted-foreground">Belum ada alert.</div>
          )}
          {alerts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-ms-2 rounded border px-ms-3 py-ms-2 text-ms-xs">
              <div className="flex items-center gap-ms-2">
                <Badge variant={a.severity === "critical" ? "destructive" : "secondary"}>{a.severity}</Badge>
                <span className="font-mono">{a.kind}</span>
                {a.code && <span className="font-mono text-muted-foreground">({a.code})</span>}
                <span>{a.count}× / {a.window_seconds}s</span>
                <span className="text-muted-foreground">{fmt(a.created_at)}</span>
              </div>
              {a.acknowledged_at ? (
                <span className="flex items-center gap-ms-1 text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Selesai {fmt(a.acknowledged_at)}
                </span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => onAck(a.id)}>Tandai selesai</Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-ms-sm">
            Event terbaru {kindFilter && <span className="ml-2 text-ms-xs text-muted-foreground">filter: {kindFilter} <button className="ml-1 underline" onClick={() => setKindFilter("")}>hapus</button></span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-ms-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Waktu</th>
                  <th>Kind</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Route</th>
                  <th>Token#</th>
                  <th>IP#</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 && (
                  <tr><td colSpan={7} className="py-ms-4 text-center text-muted-foreground">Tidak ada event.</td></tr>
                )}
                {events.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="py-1 pr-2 whitespace-nowrap">{fmt(e.created_at)}</td>
                    <td className="pr-2 font-mono">{e.kind}</td>
                    <td className="pr-2 font-mono text-muted-foreground">{e.code ?? "—"}</td>
                    <td className="pr-2 font-mono text-muted-foreground">{e.status ?? "—"}</td>
                    <td className="pr-2 text-muted-foreground">{e.route ?? "—"}</td>
                    <td className="pr-2 font-mono text-muted-foreground">{e.token_hash ?? "—"}</td>
                    <td className="pr-2 font-mono text-muted-foreground">{e.ip_hash ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}