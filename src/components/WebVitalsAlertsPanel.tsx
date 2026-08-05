/**
 * Panel admin: pengaturan ambang peringatan Core Web Vitals + riwayat alert.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Check, Play, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  acknowledgeVitalsAlert,
  checkVitalsAlertsNow,
  getVitalsAlertState,
  updateVitalsAlertConfig,
  type VitalsAlertConfig,
  type VitalsAlertRow,
} from "@/lib/web-vitals-alerts.functions";

const PAGE_LABEL: Record<string, string> = {
  katalog_list: "Halaman katalog",
  katalog_detail: "Detail produk",
};

function fmtValue(metric: string, v: number) {
  return metric === "CLS" ? v.toFixed(3) : `${(v / 1000).toFixed(2)} s`;
}

export function WebVitalsAlertsPanel() {
  const fetchState = useServerFn(getVitalsAlertState);
  const saveConfig = useServerFn(updateVitalsAlertConfig);
  const runCheck = useServerFn(checkVitalsAlertsNow);
  const ackAlert = useServerFn(acknowledgeVitalsAlert);

  const [cfg, setCfg] = useState<VitalsAlertConfig | null>(null);
  const [alerts, setAlerts] = useState<VitalsAlertRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchState({});
      setCfg(res.config);
      setAlerts(res.alerts);
    } catch {
      /* halaman induk sudah menangani akses ditolak */
    }
  }, [fetchState]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!cfg) return null;

  const patch = (p: Partial<VitalsAlertConfig>) => setCfg({ ...cfg, ...p });

  async function onSave() {
    setBusy(true);
    try {
      await saveConfig({ data: cfg });
      toast.success("Pengaturan peringatan disimpan");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  async function onRun() {
    setBusy(true);
    try {
      const res = await runCheck({});
      toast.success(
        res.fired.length
          ? `${res.fired.length} peringatan baru dipicu`
          : "Pemeriksaan selesai — semua metrik dalam ambang",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memeriksa");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lux-card mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BellRing className="h-4 w-4 text-primary" aria-hidden /> Peringatan otomatis
        </h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void onRun()} disabled={busy}>
            <Play className="mr-2 h-4 w-4" aria-hidden /> Periksa sekarang
          </Button>
          <Button size="sm" onClick={() => void onSave()} disabled={busy}>
            <Save className="mr-2 h-4 w-4" aria-hidden /> Simpan
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Sistem membandingkan p75 lapangan dengan ambang di bawah ini. Bila terlampaui, email
        peringatan dikirim (maksimal sekali per periode jeda per metrik).
        {cfg.last_check_at
          ? ` Terakhir diperiksa ${new Date(cfg.last_check_at).toLocaleString("id-ID")}.`
          : ""}
      </p>

      <div className="mt-3 flex items-center gap-3">
        <Switch
          id="cwv-alert-enabled"
          checked={cfg.enabled}
          onCheckedChange={(v) => patch({ enabled: v })}
        />
        <Label htmlFor="cwv-alert-enabled" className="text-sm">
          Aktifkan peringatan
        </Label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="cwv-email" className="text-xs">Email penerima</Label>
          <Input
            id="cwv-email"
            type="email"
            value={cfg.admin_email ?? ""}
            onChange={(e) => patch({ admin_email: e.target.value })}
            placeholder="admin@domain.com"
          />
        </div>
        <div>
          <Label htmlFor="cwv-lcp" className="text-xs">Ambang LCP (ms)</Label>
          <Input
            id="cwv-lcp"
            inputMode="numeric"
            value={cfg.lcp_threshold_ms}
            onChange={(e) => patch({ lcp_threshold_ms: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="cwv-cls" className="text-xs">Ambang CLS</Label>
          <Input
            id="cwv-cls"
            inputMode="decimal"
            value={cfg.cls_threshold}
            onChange={(e) => patch({ cls_threshold: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="cwv-inp" className="text-xs">Ambang INP (ms)</Label>
          <Input
            id="cwv-inp"
            inputMode="numeric"
            value={cfg.inp_threshold_ms}
            onChange={(e) => patch({ inp_threshold_ms: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="cwv-min" className="text-xs">Minimal sampel</Label>
          <Input
            id="cwv-min"
            inputMode="numeric"
            value={cfg.min_samples}
            onChange={(e) => patch({ min_samples: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="cwv-window" className="text-xs">Jendela waktu (menit)</Label>
          <Input
            id="cwv-window"
            inputMode="numeric"
            value={cfg.window_minutes}
            onChange={(e) => patch({ window_minutes: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="cwv-cooldown" className="text-xs">Jeda antar peringatan (menit)</Label>
          <Input
            id="cwv-cooldown"
            inputMode="numeric"
            value={cfg.cooldown_minutes}
            onChange={(e) => patch({ cooldown_minutes: Number(e.target.value) || 0 })}
          />
        </div>
      </div>

      <h3 className="mt-5 text-sm font-semibold">Riwayat peringatan</h3>
      {alerts.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">Belum ada peringatan.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className="rounded-lg border border-border/60 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    a.severity === "critical"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-amber-500/15 text-amber-500"
                  }`}
                >
                  {a.severity === "critical" ? "Kritis" : "Perhatian"}
                </span>
                <span className="font-medium">
                  {a.metric} · {PAGE_LABEL[a.page] ?? a.page}
                </span>
                <span className="text-xs text-muted-foreground">
                  {fmtValue(a.metric, a.p75)} vs ambang {fmtValue(a.metric, a.threshold)} ·{" "}
                  {new Date(a.created_at).toLocaleString("id-ID")}
                </span>
                {a.acknowledged_at ? (
                  <span className="text-xs text-primary">sudah dibaca</span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 px-2 text-xs"
                    onClick={async () => {
                      await ackAlert({ data: { id: a.id } });
                      await load();
                    }}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" aria-hidden /> Tandai dibaca
                  </Button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{a.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}