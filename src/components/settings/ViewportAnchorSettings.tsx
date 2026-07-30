import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Smartphone, RotateCcw, Wand2, Trash2, Activity } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  DEFAULT_VIEWPORT_ANCHOR_CONFIG,
  VIEWPORT_ANCHOR_PRESETS,
  getViewportAnchorConfig,
  setViewportAnchorConfig,
  type ViewportAnchorConfig,
} from "@/lib/viewport-anchor-config";
import {
  useViewportAnchor,
  useViewportAnchorState,
  type ViewportAnchorMode,
} from "@/lib/use-viewport-anchor";
import {
  VIEWPORT_AUTOTUNE_EVENT,
  clearAutotuneHistory,
  getAutotuneHistory,
  getAutotuneStats,
  isAutotuneEnabled,
  setAutotuneEnabled,
  type AutotuneAdjustment,
  type AutotuneStats,
} from "@/lib/viewport-anchor-autotune";

const FIELD_LABEL: Record<string, string> = {
  keyboardOpenPx: "Ambang buka",
  keyboardClosePx: "Ambang tutup",
  scrollGraceMs: "Grace scroll",
  maxChromePx: "Max address bar",
  settleMs: "Durasi ukur",
  hysteresisPx: "Toleransi getar",
};

type NumKey = Exclude<keyof ViewportAnchorConfig, "enabled">;

const MODE_META: Record<
  ViewportAnchorMode,
  { label: string; hint: string; dot: string; badge: string }
> = {
  idle: {
    label: "Idle",
    hint: "Viewport penuh — tidak ada kompensasi.",
    dot: "bg-muted-foreground",
    badge: "border-border text-muted-foreground",
  },
  chrome: {
    label: "Address bar",
    hint: "Penyusutan dari toolbar browser — bar dibiarkan menempel di dasar layar.",
    dot: "bg-amber-500",
    badge: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  },
  keyboard: {
    label: "Keyboard terbuka",
    hint: "Kompensasi transform aktif agar bar tetap di atas keyboard.",
    dot: "bg-emerald-500",
    badge: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  },
};

const FIELDS: {
  key: NumKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}[] = [
  {
    key: "keyboardOpenPx",
    label: "Ambang keyboard terbuka",
    hint: "Viewport harus menyusut sebanyak ini sebelum dianggap keyboard muncul.",
    min: 60,
    max: 320,
    step: 10,
    unit: "px",
  },
  {
    key: "keyboardClosePx",
    label: "Ambang keyboard tertutup",
    hint: "Selalu lebih kecil dari ambang buka (mencegah status berkedip).",
    min: 40,
    max: 300,
    step: 10,
    unit: "px",
  },
  {
    key: "scrollGraceMs",
    label: "Jendela setelah scroll",
    hint: "Penyusutan dalam rentang ini dianggap address bar, bukan keyboard. Naikkan di HP lambat.",
    min: 0,
    max: 1200,
    step: 50,
    unit: "ms",
  },
  {
    key: "maxChromePx",
    label: "Tinggi maksimal address bar",
    hint: "Batas wajar toolbar browser di perangkat ini.",
    min: 80,
    max: 320,
    step: 10,
    unit: "px",
  },
  {
    key: "settleMs",
    label: "Durasi pengukuran per-frame",
    hint: "Makin kecil makin hemat CPU (baik untuk low-end), makin besar makin mulus.",
    min: 80,
    max: 1200,
    step: 20,
    unit: "ms",
  },
  {
    key: "hysteresisPx",
    label: "Toleransi getaran",
    hint: "Abaikan pergeseran sekecil ini. Naikkan bila bar terlihat bergetar.",
    min: 0,
    max: 12,
    step: 1,
    unit: "px",
  },
];

export function ViewportAnchorSettings() {
  const [cfg, setCfg] = useState<ViewportAnchorConfig>(DEFAULT_VIEWPORT_ANCHOR_CONFIG);
  const { keyboardOpen } = useViewportAnchor({ lock: true });
  const live = useViewportAnchorState();
  const mode = MODE_META[live.mode];
  const [autoOn, setAutoOn] = useState(false);
  const [history, setHistory] = useState<AutotuneAdjustment[]>([]);
  const [autoStats, setAutoStats] = useState<AutotuneStats | null>(null);

  useEffect(() => {
    setCfg(getViewportAnchorConfig());
  }, []);

  useEffect(() => {
    const sync = () => {
      setAutoOn(isAutotuneEnabled());
      setHistory([...getAutotuneHistory()]);
      setAutoStats({ ...getAutotuneStats() });
      setCfg(getViewportAnchorConfig());
    };
    sync();
    window.addEventListener(VIEWPORT_AUTOTUNE_EVENT, sync);
    return () => window.removeEventListener(VIEWPORT_AUTOTUNE_EVENT, sync);
  }, []);

  const apply = (patch: Partial<ViewportAnchorConfig>) => {
    setCfg(setViewportAnchorConfig(patch));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-ms-2 text-ms-base">
          <Smartphone className="h-4 w-4" />
          Sensitivitas kompensasi viewport
        </CardTitle>
        <CardDescription className="text-ms-xs">
          Atur seberapa agresif bar bawah menyesuaikan diri saat address bar atau
          keyboard muncul. Perubahan langsung berlaku dan tersimpan di perangkat ini.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-ms-4">
        <div className="rounded-lg border bg-muted/30 p-ms-3 space-y-ms-2">
          <div className="flex items-center justify-between gap-ms-2">
            <div className="flex items-center gap-ms-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${mode.dot} ${
                  live.mode === "idle" ? "" : "animate-pulse"
                }`}
                aria-hidden
              />
              <span className="text-ms-sm font-medium">Status langsung</span>
            </div>
            <Badge variant="outline" className={`tabular-nums ${mode.badge}`}>
              {mode.label}
            </Badge>
          </div>
          <p className="text-ms-xs text-muted-foreground">{mode.hint}</p>
          <dl className="grid grid-cols-2 gap-x-ms-3 gap-y-1 text-[11px] tabular-nums sm:grid-cols-4">
            {[
              { k: "Penyusutan", v: `${live.shrinkPx}px` },
              { k: "Offset aktif", v: `${live.offsetPx}px` },
              { k: "Viewport", v: `${live.viewportPx}px` },
              { k: "Baseline", v: `${live.baselinePx}px` },
            ].map((it) => (
              <div key={it.k} className="flex justify-between gap-2 sm:block">
                <dt className="text-muted-foreground">{it.k}</dt>
                <dd className="font-medium text-foreground">{it.v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-1.5 border-t pt-ms-2 text-[11px] tabular-nums">
            <span className="text-muted-foreground">Ambang aktif:</span>
            <span
              className={
                live.shrinkPx > cfg.keyboardOpenPx ? "font-semibold text-foreground" : ""
              }
            >
              buka &gt;{cfg.keyboardOpenPx}px
            </span>
            <span aria-hidden className="text-muted-foreground">·</span>
            <span
              className={
                live.shrinkPx < cfg.keyboardClosePx ? "font-semibold text-foreground" : ""
              }
            >
              tutup &lt;{cfg.keyboardClosePx}px
            </span>
            <span aria-hidden className="text-muted-foreground">·</span>
            <span className={live.recentlyScrolled ? "font-semibold text-foreground" : ""}>
              grace {cfg.scrollGraceMs}ms {live.recentlyScrolled ? "(aktif)" : ""}
            </span>
            <span aria-hidden className="text-muted-foreground">·</span>
            <span>max chrome {cfg.maxChromePx}px</span>
            <span aria-hidden className="text-muted-foreground">·</span>
            <span>toleransi {cfg.hysteresisPx}px</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-ms-3">
          <div>
            <p className="text-ms-sm font-medium">Aktifkan kompensasi</p>
            <p className="text-ms-xs text-muted-foreground">
              Matikan bila bar bawah terasa "melompat" di perangkat ini.
            </p>
          </div>
          <Switch
            checked={cfg.enabled}
            onCheckedChange={(v) => apply({ enabled: v })}
            aria-label="Aktifkan kompensasi viewport"
          />
        </div>

        <div className="space-y-ms-3 rounded-lg border border-primary/25 bg-primary/5 p-ms-3">
          <div className="flex items-start justify-between gap-ms-3">
            <div>
              <p className="flex items-center gap-ms-2 text-ms-sm font-medium">
                <Wand2 className="h-4 w-4" />
                Auto-tuning ambang
              </p>
              <p className="text-ms-xs text-muted-foreground">
                Sistem memantau kestabilan posisi bar bawah di perangkat ini lalu
                menyesuaikan ambang sedikit demi sedikit (maks. satu langkah tiap
                ±15 detik). Slider di bawah tetap bisa diubah manual kapan saja.
              </p>
            </div>
            <Switch
              checked={autoOn}
              onCheckedChange={(v) => {
                setAutotuneEnabled(v);
                setAutoOn(v);
                toast.success(v ? "Auto-tuning aktif" : "Auto-tuning dimatikan");
              }}
              aria-label="Aktifkan auto-tuning ambang viewport"
            />
          </div>

          {autoOn && autoStats && (
            <dl className="grid grid-cols-2 gap-x-ms-3 gap-y-1 text-[11px] tabular-nums sm:grid-cols-4">
              {[
                { k: "Skor stabilitas", v: `${autoStats.score}/100` },
                { k: "Jendela dianalisis", v: `${autoStats.windows}` },
                { k: "Stabil beruntun", v: `${autoStats.stableStreak}` },
                {
                  k: "Sampel terakhir",
                  v: `${autoStats.lastWindow.samples}`,
                },
              ].map((it) => (
                <div key={it.k} className="flex justify-between gap-2 sm:block">
                  <dt className="text-muted-foreground">{it.k}</dt>
                  <dd className="font-medium text-foreground">{it.v}</dd>
                </div>
              ))}
            </dl>
          )}

          {autoOn && (
            <div className="space-y-1.5 border-t border-primary/20 pt-ms-2">
              <div className="flex items-center justify-between gap-ms-2">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Penyesuaian terakhir
                </p>
                {history.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => {
                      clearAutotuneHistory();
                      toast.success("Riwayat auto-tuning dibersihkan");
                    }}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Bersihkan
                  </Button>
                )}
              </div>
              {history.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Belum ada penyesuaian — pakai aplikasi seperti biasa, sistem akan
                  belajar sendiri.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {history.slice(0, 5).map((h) => (
                    <li key={h.at} className="rounded-md bg-background/70 p-ms-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[11px] leading-snug">{h.label}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {new Date(h.at).toLocaleTimeString("id-ID", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {h.changes.map((c) => (
                          <Badge
                            key={String(c.key)}
                            variant="secondary"
                            className="text-[10px] tabular-nums"
                          >
                            {FIELD_LABEL[String(c.key)] ?? String(c.key)}: {c.from} →{" "}
                            {c.to}
                          </Badge>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="space-y-ms-2 border-t pt-ms-3">
          <p className="text-ms-xs font-medium text-muted-foreground">Preset cepat</p>
          <div className="grid grid-cols-1 gap-ms-2 sm:grid-cols-3">
            {Object.entries(VIEWPORT_ANCHOR_PRESETS).map(([id, preset]) => (
              <Button
                key={id}
                variant="outline"
                size="sm"
                className="h-auto flex-col items-start gap-1 py-ms-2 text-left"
                onClick={() => {
                  apply(preset.value);
                  toast.success(`Preset "${preset.label}" diterapkan`);
                }}
              >
                <span className="text-ms-xs font-medium">{preset.label}</span>
                <span className="text-[11px] font-normal leading-snug text-muted-foreground whitespace-normal">
                  {preset.hint}
                </span>
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-ms-4 border-t pt-ms-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-ms-2">
              <div className="flex items-center justify-between gap-ms-2">
                <span className="text-ms-sm font-medium">{f.label}</span>
                <Badge variant="secondary" className="tabular-nums">
                  {cfg[f.key]}
                  {f.unit}
                </Badge>
              </div>
              <Slider
                value={[cfg[f.key]]}
                min={f.min}
                max={f.max}
                step={f.step}
                disabled={!cfg.enabled && f.key !== "hysteresisPx"}
                onValueChange={([v]) => apply({ [f.key]: v } as Partial<ViewportAnchorConfig>)}
                aria-label={f.label}
              />
              <p className="text-ms-xs text-muted-foreground">{f.hint}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-ms-2 border-t pt-ms-3">
          <p className="text-ms-xs text-muted-foreground">
            Status keyboard terdeteksi:{" "}
            <span className="font-medium text-foreground">
              {keyboardOpen ? "terbuka" : "tertutup"}
            </span>
          </p>
          <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" asChild>
            <Link to="/diagnostik-viewport">
              <Activity className="mr-1.5 h-3.5 w-3.5" />
              Diagnostik
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              apply(DEFAULT_VIEWPORT_ANCHOR_CONFIG);
              toast.success("Sensitivitas viewport kembali ke bawaan");
            }}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Bawaan
          </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
