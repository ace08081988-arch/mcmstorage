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
import { Smartphone, RotateCcw } from "lucide-react";
import {
  DEFAULT_VIEWPORT_ANCHOR_CONFIG,
  VIEWPORT_ANCHOR_PRESETS,
  getViewportAnchorConfig,
  setViewportAnchorConfig,
  type ViewportAnchorConfig,
} from "@/lib/viewport-anchor-config";
import { useViewportAnchor } from "@/lib/use-viewport-anchor";

type NumKey = Exclude<keyof ViewportAnchorConfig, "enabled">;

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

  useEffect(() => {
    setCfg(getViewportAnchorConfig());
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
      </CardContent>
    </Card>
  );
}
