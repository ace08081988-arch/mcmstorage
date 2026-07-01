import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { DEFAULT_APP_PREFS, useAppPrefs } from "@/lib/app-prefs";

export const Route = createFileRoute("/_authenticated/pengaturan-aksesibilitas")({
  head: () => ({ meta: [{ title: "Aksesibilitas · MCM Storage" }] }),
  component: PengaturanAksesibilitasPage,
});

function PengaturanAksesibilitasPage() {
  const { prefs, set, reset } = useAppPrefs();
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setSystemReducedMotion(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-8">
      <SettingsHeader
        title="Aksesibilitas"
        subtitle="Skala teks, kontras, dan animasi"
      />
      <div className="space-y-4 px-4 pt-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Skala teks</CardTitle>
            <CardDescription className="text-xs">
              Perbesar teks di seluruh aplikasi. Diterapkan lewat variabel CSS <code>--app-font-scale</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm">Kecil</span>
              <span className="text-sm tabular-nums font-semibold">
                {Math.round(prefs.fontScale * 100)}%
              </span>
              <span className="text-sm">Besar</span>
            </div>
            <Slider
              value={[prefs.fontScale]}
              min={0.9}
              max={1.4}
              step={0.05}
              onValueChange={(v) => set({ fontScale: v[0] ?? 1 })}
              aria-label="Skala teks"
            />
            <div
              className="rounded-md border bg-muted/30 p-3 text-muted-foreground"
              style={{ fontSize: `${prefs.fontScale}rem` }}
            >
              Pratinjau — teks pesan chat, tombol, dan header ikut menyesuaikan.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Kontras & animasi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ToggleRow
              label="Tingkatkan kontras"
              help="Perkuat border dan ring fokus supaya elemen lebih terlihat."
              checked={prefs.highContrast}
              onChange={(v) => set({ highContrast: v })}
            />
            <ToggleRow
              label="Kurangi animasi"
              help={
                systemReducedMotion
                  ? "Sistem juga sedang meminta reduce-motion — pengaturan ini menambah cakupan ke animasi in-app."
                  : "Hilangkan slide/fade non-esensial (mis. hint scroll-guard)."
              }
              checked={prefs.reduceMotion}
              onChange={(v) => set({ reduceMotion: v })}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reset()}
            disabled={
              prefs.fontScale === DEFAULT_APP_PREFS.fontScale &&
              !prefs.highContrast &&
              !prefs.reduceMotion
            }
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset aksesibilitas
          </Button>
        </div>
      </div>
    </main>
  );
}

function ToggleRow({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = `t-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        <p className="text-[11px] leading-snug text-muted-foreground">{help}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}