import { useSyncExternalStore } from "react";
import { BellRing, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DEFAULT_ALERT_PREFS,
  clearScrollPerfAlerts,
  listScrollPerfAlerts,
  loadAlertPrefs,
  saveAlertPrefs,
  subscribeScrollPerfAlerts,
  type ScrollPerfAlert,
} from "@/lib/scroll-perf-alerts";

const EMPTY: ScrollPerfAlert[] = [];

const REASON_LABEL: Record<ScrollPerfAlert["reason"], string> = {
  fps: "FPS rendah",
  latency: "Latensi tinggi",
  both: "FPS & latensi",
};

function timeLabel(at: number) {
  return new Date(at).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Ambang peringatan performa scroll + riwayat peringatan terakhir. */
export function ScrollPerfAlertsCard() {
  const prefs = useSyncExternalStore(
    subscribeScrollPerfAlerts,
    loadAlertPrefs,
    () => DEFAULT_ALERT_PREFS,
  );
  const alerts = useSyncExternalStore(
    subscribeScrollPerfAlerts,
    listScrollPerfAlerts,
    () => EMPTY,
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-ms-2">
          <div>
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <BellRing className="h-4 w-4" aria-hidden />
              Peringatan performa
            </CardTitle>
            <CardDescription className="text-ms-xs">
              Muncul otomatis begitu satu fase gulir selesai dan hasilnya di bawah
              ambang, jadi lonjakan langsung terlihat tanpa membuka halaman ini.
            </CardDescription>
          </div>
          <Switch
            checked={prefs.enabled}
            onCheckedChange={(v) => saveAlertPrefs({ enabled: v })}
            aria-label="Aktifkan peringatan performa scroll"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-ms-4">
        <div className="space-y-ms-2">
          <div className="flex items-center justify-between">
            <Label className="text-ms-xs">FPS minimum</Label>
            <span className="text-ms-xs font-semibold tabular-nums">{prefs.fpsMin} fps</span>
          </div>
          <Slider
            value={[prefs.fpsMin]}
            min={20}
            max={60}
            step={1}
            disabled={!prefs.enabled}
            onValueChange={([v]) => saveAlertPrefs({ fpsMin: v })}
          />
        </div>

        <div className="space-y-ms-2">
          <div className="flex items-center justify-between">
            <Label className="text-ms-xs">Batas latensi scroll</Label>
            <span className="text-ms-xs font-semibold tabular-nums">{prefs.latencyMaxMs} ms</span>
          </div>
          <Slider
            value={[prefs.latencyMaxMs]}
            min={20}
            max={200}
            step={5}
            disabled={!prefs.enabled}
            onValueChange={([v]) => saveAlertPrefs({ latencyMaxMs: v })}
          />
        </div>

        <div className="space-y-ms-2">
          <div className="flex items-center justify-between">
            <Label className="text-ms-xs">Jeda antar peringatan</Label>
            <span className="text-ms-xs font-semibold tabular-nums">{prefs.cooldownSec} dtk</span>
          </div>
          <Slider
            value={[prefs.cooldownSec]}
            min={5}
            max={120}
            step={5}
            disabled={!prefs.enabled}
            onValueChange={([v]) => saveAlertPrefs({ cooldownSec: v })}
          />
        </div>

        <div className="space-y-ms-2">
          <div className="flex items-center justify-between gap-ms-2">
            <p className="text-ms-2xs text-muted-foreground">
              {alerts.length > 0
                ? `${alerts.length} peringatan terakhir`
                : "Belum ada peringatan tercatat"}
            </p>
            <div className="flex gap-ms-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  toast.warning("Contoh peringatan", {
                    description: `FPS 32 (ambang ${prefs.fpsMin}) · 4 frame tersendat`,
                  })
                }
              >
                Uji
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={alerts.length === 0}
                onClick={() => clearScrollPerfAlerts()}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                Kosongkan
              </Button>
            </div>
          </div>
          {alerts.length > 0 ? (
            <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border text-[11px] tabular-nums">
              {alerts.map((a) => (
                <li key={a.at} className="flex items-center gap-ms-2 px-ms-2 py-1.5">
                  <span className="w-16 shrink-0 text-muted-foreground">{timeLabel(a.at)}</span>
                  <Badge variant="outline" className="shrink-0">
                    {REASON_LABEL[a.reason]}
                  </Badge>
                  <span className="min-w-0 flex-1 break-words">
                    {a.fps} fps · {a.latencyMs} ms · {a.jankFrames} jank
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default ScrollPerfAlertsCard;
