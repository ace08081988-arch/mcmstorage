import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Laptop, LogOut, RefreshCw, ShieldAlert, Smartphone, Monitor } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateDeviceId } from "@/lib/device-sessions";

type DeviceSession = {
  id: string;
  device_id: string;
  label: string | null;
  user_agent: string | null;
  platform: string | null;
  last_seen_at: string;
  created_at: string;
  revoked_at: string | null;
};

export const Route = createFileRoute("/_authenticated/sesi")({
  component: SesiPage,
  errorComponent: ({ error, reset }) => (
    <div className="mx-auto max-w-md p-6 text-sm">
      <p className="mb-3 text-destructive">Gagal memuat sesi: {error.message}</p>
      <Button onClick={reset} variant="outline">Coba lagi</Button>
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Halaman tidak ditemukan.</div>,
});

function relativeTime(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  if (diff < 0) return "baru saja";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} dtk lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  return `${d} hari lalu`;
}

function iconFor(label: string | null, ua: string | null) {
  const s = `${label ?? ""} ${ua ?? ""}`.toLowerCase();
  if (/android|iphone|ipad|mobile/.test(s)) return Smartphone;
  if (/windows|mac|linux/.test(s)) return Monitor;
  return Laptop;
}

function SesiPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const currentDeviceId = useMemo(() => getOrCreateDeviceId(), []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const sessionsQ = useQuery({
    queryKey: ["device-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("device_sessions")
        .select("id, device_id, label, user_agent, platform, last_seen_at, created_at, revoked_at")
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DeviceSession[];
    },
  });

  const revoke = useMutation({
    mutationFn: async (deviceId: string) => {
      const { error } = await supabase
        .from("device_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("device_id", deviceId);
      if (error) throw error;
    },
    onSuccess: (_d, deviceId) => {
      queryClient.invalidateQueries({ queryKey: ["device-sessions"] });
      if (deviceId === currentDeviceId) {
        // Logout perangkat ini → langsung signOut lokal juga.
        void supabase.auth.signOut().finally(() => {
          window.location.replace("/auth");
        });
      } else {
        toast.success("Perangkat dicabut. Sesi akan ditutup paling lambat 1 menit.");
      }
    },
    onError: (e: Error) => toast.error(`Gagal mencabut: ${e.message}`),
  });

  const revokeOthers = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("device_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .neq("device_id", currentDeviceId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["device-sessions"] });
      toast.success("Semua perangkat lain dicabut.");
    },
    onError: (e: Error) => toast.error(`Gagal mencabut: ${e.message}`),
  });

  const sessions = sessionsQ.data ?? [];
  const active = sessions.filter((s) => !s.revoked_at);
  const revoked = sessions.filter((s) => s.revoked_at);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Sesi & Perangkat</h1>
          <p className="text-xs text-muted-foreground">
            Daftar perangkat tempat akun Anda login. Cabut akses kapan saja.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => sessionsQ.refetch()}
          disabled={sessionsQ.isFetching}
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${sessionsQ.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      {active.length > 1 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start justify-between gap-3 py-3">
            <div className="flex items-start gap-2 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-600" />
              <div>
                <div className="font-medium">Logout dari semua perangkat lain</div>
                <div className="text-xs text-muted-foreground">
                  Mempertahankan sesi perangkat ini saja.
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => revokeOthers.mutate()}
              disabled={revokeOthers.isPending}
            >
              <LogOut className="mr-1 h-3.5 w-3.5" /> Cabut lainnya
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Perangkat aktif ({active.length})
        </h2>
        {sessionsQ.isLoading ? (
          <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">Memuat…</CardContent></Card>
        ) : active.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">Belum ada sesi tercatat.</CardContent></Card>
        ) : (
          active.map((s) => {
            const Icon = iconFor(s.label, s.user_agent);
            const isCurrent = s.device_id === currentDeviceId;
            return (
              <Card key={s.id}>
                <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <span className="truncate">{s.label ?? "Perangkat tidak dikenal"}</span>
                      {isCurrent ? <Badge variant="default" className="h-5 text-[10px]">Perangkat ini</Badge> : null}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Aktif {relativeTime(s.last_seen_at, now)} · Login {relativeTime(s.created_at, now)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={isCurrent ? "destructive" : "outline"}
                    onClick={() => revoke.mutate(s.device_id)}
                    disabled={revoke.isPending}
                  >
                    <LogOut className="mr-1 h-3.5 w-3.5" />
                    {isCurrent ? "Logout perangkat ini" : "Cabut"}
                  </Button>
                </CardHeader>
                {s.user_agent ? (
                  <CardContent className="pt-0">
                    <p className="truncate text-[11px] text-muted-foreground" title={s.user_agent}>
                      {s.user_agent}
                    </p>
                  </CardContent>
                ) : null}
              </Card>
            );
          })
        )}
      </section>

      {revoked.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Riwayat dicabut ({revoked.length})
          </h2>
          {revoked.map((s) => {
            const Icon = iconFor(s.label, s.user_agent);
            return (
              <Card key={s.id} className="opacity-70">
                <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-sm">
                      <span className="truncate">{s.label ?? "Perangkat"}</span>
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Dicabut {s.revoked_at ? relativeTime(s.revoked_at, now) : "-"}
                    </p>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </section>
      ) : null}

      <p className="pt-2 text-center text-[11px] text-muted-foreground">
        Sesi yang dicabut akan ditutup otomatis pada perangkat tersebut dalam 1 menit. Pastikan kata sandi
        Anda kuat dan tidak dibagikan ke siapa pun.
      </p>
      {/* hindari unused warning untuk router */}
      {router ? null : null}
    </div>
  );
}