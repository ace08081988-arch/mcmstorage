import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  RefreshCw,
  Mail,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Send,
} from "lucide-react";
import { getEmailQueueStatus, resendDeviceOtpByMessage } from "@/lib/email-queue.functions";
import { toast } from "sonner";
import { useAdminStatus } from "@/hooks/use-is-admin";

export const Route = createFileRoute("/_authenticated/email-queue")({
  head: () => ({
    meta: [
      { title: "Status Antrian Email · MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: EmailQueuePage,
});

function fmtAbs(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("id-ID", { hour12: false });
  } catch {
    return iso;
  }
}

function fmtAgo(iso: string | null | undefined) {
  if (!iso) return "belum pernah";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} detik lalu`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "sent")
    return <Badge className="bg-success hover:bg-success">Terkirim</Badge>;
  if (s === "pending")
    return <Badge className="bg-warning hover:bg-warning">Antrian</Badge>;
  if (s === "dlq")
    return <Badge variant="destructive">Gagal (DLQ)</Badge>;
  if (s === "suppressed")
    return <Badge className="bg-yellow-500 hover:bg-yellow-500">Diblokir</Badge>;
  if (s === "failed" || s === "bounced" || s === "complained")
    return <Badge variant="destructive">{status}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function EmailQueuePage() {
  const fetchStatus = useServerFn(getEmailQueueStatus);
  const resendOtp = useServerFn(resendDeviceOtpByMessage);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Route-level guard: jangan panggil server fn admin sama sekali kalau
  // user belum terbukti admin. Non-admin melihat fallback statis; status
  // pending menampilkan skeleton ringan tanpa memicu request.
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const q = useQuery({
    queryKey: ["email-queue-status"],
    queryFn: () => fetchStatus(),
    enabled: isAdmin,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });

  async function handleResend(row: { id: string; message_id: string | null; recipient_email: string }) {
    if (!row.message_id) {
      toast.error("Tidak ada message_id untuk baris ini");
      return;
    }
    setBusyId(row.id);
    try {
      const res = await resendOtp({ data: { messageId: row.message_id } });
      if (res.ok) {
        toast.success(`OTP baru dikirim ulang ke ${res.recipient}`);
        q.refetch();
      } else {
        toast.error(`Gagal resend: ${res.error}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal resend OTP");
    } finally {
      setBusyId(null);
    }
  }

  const data = q.data;
  const h = data?.health ?? null;
  const pendingTotal = (h?.pending_auth ?? 0) + (h?.pending_transactional ?? 0);
  const dlqTotal = (h?.dlq_auth ?? 0) + (h?.dlq_transactional ?? 0);

  const lastSent = h?.last_sent_at ?? null;
  const minutesSinceSent = lastSent
    ? Math.round((Date.now() - new Date(lastSent).getTime()) / 60000)
    : null;
  const cronHealthy = minutesSinceSent !== null && minutesSinceSent <= 30;

  return (
    <div className="mx-auto w-full max-w-4xl space-ms-4 p-ms-4">
      <div className="flex items-center justify-between gap-ms-2">
        <Link
          to="/diagnostics"
          className="inline-flex items-center gap-ms-1 text-ms-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Diagnostik
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      <div>
        <h1 className="text-ms-2xl font-semibold">Status Antrian Email & OTP</h1>
        <p className="text-ms-sm text-muted-foreground">
          Pantau apakah OTP perangkat sedang diproses, masuk antrian, atau gagal terkirim.
          Halaman ini menyegarkan otomatis setiap 10 detik.
        </p>
      </div>

      {isCheckingAdmin ? (
        <Card>
          <CardContent className="p-ms-6 text-ms-sm text-muted-foreground">
            Memeriksa akses…
          </CardContent>
        </Card>
      ) : !isAdmin ? (
        <Card>
          <CardContent className="space-ms-2 p-ms-6 text-ms-sm">
            <div className="font-medium">Halaman ini hanya untuk admin.</div>
            <p className="text-muted-foreground">
              Anda tidak memiliki akses ke antrian email. Kembali ke{" "}
              <Link to="/diagnostics" className="underline">
                Diagnostik
              </Link>{" "}
              atau{" "}
              <Link to="/" className="underline">
                halaman utama
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : q.isLoading ? (
        <Card>
          <CardContent className="p-ms-6 text-ms-sm text-muted-foreground">Memuat status…</CardContent>
        </Card>
      ) : !data?.isAdmin ? (
        <Card>
          <CardContent className="p-ms-6 text-ms-sm text-muted-foreground">
            Halaman ini hanya untuk admin.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card
            className={
              cronHealthy
                ? "border-success/40 bg-success/5"
                : "border-warning/40 bg-warning/5"
            }
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-ms-2 text-ms-base">
                {cronHealthy ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-warning" />
                )}
                Pemroses antrian {cronHealthy ? "berjalan normal" : "perlu diperiksa"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-ms-1 text-ms-sm">
              <div className="flex items-center gap-ms-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Terakhir memproses email:</span>
                <span className="font-medium">{fmtAgo(lastSent)}</span>
                <span className="text-muted-foreground">({fmtAbs(lastSent)})</span>
              </div>
              <div className="text-ms-xs text-muted-foreground">
                Diperbarui {fmtAgo(data.fetchedAt)} · {fmtAbs(data.fetchedAt)}
              </div>
              {!cronHealthy && (
                <div className="mt-2 rounded-md bg-warning/10 p-ms-2 text-ms-xs text-warning dark:text-warning">
                  Tidak ada email terkirim &gt;30 menit terakhir. Cek apakah cron pemroses
                  antrian aktif atau apakah ada error provider.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-ms-3 sm:grid-cols-4">
            <StatCard
              icon={<Mail className="h-4 w-4" />}
              label="Antrian aktif"
              value={pendingTotal}
              hint={`auth ${h?.pending_auth ?? 0} • app ${h?.pending_transactional ?? 0}`}
              tone={pendingTotal > 0 ? "warn" : "ok"}
            />
            <StatCard
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Terkirim 30 mnt"
              value={h?.sent_last_30m ?? 0}
              tone="ok"
            />
            <StatCard
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Gagal 30 mnt"
              value={h?.failed_last_30m ?? 0}
              tone={(h?.failed_last_30m ?? 0) > 0 ? "warn" : "ok"}
            />
            <StatCard
              icon={<Activity className="h-4 w-4" />}
              label="DLQ"
              value={dlqTotal}
              hint={`auth ${h?.dlq_auth ?? 0} • app ${h?.dlq_transactional ?? 0}`}
              tone={dlqTotal > 0 ? "danger" : "ok"}
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-ms-base">25 OTP perangkat terbaru</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {data.recentOtp.length === 0 ? (
                <div className="px-ms-6 pb-4 text-ms-sm text-muted-foreground">
                  Belum ada permintaan OTP.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-ms-sm">
                    <thead className="bg-muted/50 text-ms-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-ms-4 py-ms-2 text-left">Waktu</th>
                        <th className="px-ms-4 py-ms-2 text-left">Penerima</th>
                        <th className="px-ms-4 py-ms-2 text-left">Status</th>
                        <th className="px-ms-4 py-ms-2 text-left">Catatan</th>
                        <th className="px-ms-4 py-ms-2 text-left">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentOtp.map((r) => (
                        <tr key={r.id} className="border-t border-border/60">
                          <td className="px-ms-4 py-ms-2 align-top">
                            <div className="font-medium">{fmtAgo(r.created_at)}</div>
                            <div className="text-ms-xs text-muted-foreground">
                              {fmtAbs(r.created_at)}
                            </div>
                          </td>
                          <td className="px-ms-4 py-ms-2 align-top">{r.recipient_email}</td>
                          <td className="px-ms-4 py-ms-2 align-top">{statusBadge(r.status)}</td>
                          <td className="px-ms-4 py-ms-2 align-top text-ms-xs text-muted-foreground">
                            {r.error_message || "—"}
                          </td>
                          <td className="px-ms-4 py-ms-2 align-top">
                            {(() => {
                              const s = r.status.toLowerCase();
                              const canResend = s === "pending" || s === "dlq" || s === "failed" || s === "bounced";
                              if (!canResend) return <span className="text-ms-xs text-muted-foreground">—</span>;
                              return (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busyId === r.id || !r.message_id}
                                  onClick={() => handleResend(r)}
                                >
                                  <Send className={`h-3.5 w-3.5 ${busyId === r.id ? "animate-pulse" : ""}`} />
                                  <span className="ml-1.5">Resend</span>
                                </Button>
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  tone: "ok" | "warn" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/40 bg-destructive/5"
      : tone === "warn"
      ? "border-warning/40 bg-warning/5"
      : "border-border/60";
  return (
    <Card className={toneClass}>
      <CardContent className="p-ms-3">
        <div className="flex items-center gap-ms-2 text-ms-xs text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className="mt-1 text-ms-2xl font-semibold tabular-nums">{value}</div>
        {hint ? <div className="text-ms-2xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}