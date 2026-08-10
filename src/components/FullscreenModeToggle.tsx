import { useEffect, useState } from "react";
import { Maximize, Minimize, MousePointerClick, Rocket, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  applyDisplayMode,
  applyFullscreenPref,
  canRequestFullscreen,
  currentDisplayMode,
  readFullscreenPref,
  writeFullscreenPref,
  type FullscreenPref,
} from "@/lib/fullscreen-mode";
import {
  DEFAULT_SCROLL_SETTINGS,
  readScrollSettings,
  writeScrollSettings,
  type FullscreenScrollSettings,
} from "@/lib/fullscreen-scroll";

const THRESHOLDS: { value: number; label: string }[] = [
  { value: 0, label: "Langsung" },
  { value: 80, label: "Sedang" },
  { value: 200, label: "Jauh" },
];

const OPTIONS: { id: FullscreenPref; label: string; hint: string; Icon: typeof Maximize }[] = [
  { id: "auto", label: "Otomatis", hint: "Ikut cara aplikasi dibuka", Icon: Smartphone },
  { id: "on", label: "Selalu", hint: "Kembali penuh tiap kali keluar", Icon: Maximize },
  { id: "launch", label: "Saat membuka", hint: "Sekali di awal, lalu bebas", Icon: Rocket },
  { id: "scroll", label: "Saat scroll", hint: "Penuh begitu mulai menggulir", Icon: MousePointerClick },
  { id: "off", label: "Normal", hint: "Tampilkan bilah sistem", Icon: Minimize },
];

/** Pengaturan mode layar penuh untuk PWA (iOS & Android). */
export function FullscreenModeToggle() {
  const [pref, setPref] = useState<FullscreenPref>("auto");
  const [mode, setMode] = useState("browser");
  const [scroll, setScroll] = useState<FullscreenScrollSettings>(DEFAULT_SCROLL_SETTINGS);
  const supported = canRequestFullscreen();

  useEffect(() => {
    setPref(readFullscreenPref());
    setMode(currentDisplayMode());
    setScroll(readScrollSettings());
    const sync = () => setMode(currentDisplayMode());
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const patchScroll = (next: Partial<FullscreenScrollSettings>) => {
    setScroll((prev) => ({ ...prev, ...next }));
    writeScrollSettings(next);
  };

  const choose = (next: FullscreenPref) => {
    setPref(next);
    writeFullscreenPref(next);
    // Dipanggil dari klik → boleh meminta Fullscreen API.
    void applyFullscreenPref(true).then(() => {
      applyDisplayMode();
      setMode(currentDisplayMode());
    });
  };

  const installed = mode === "standalone" || mode === "fullscreen";

  return (
    <div className="space-ms-3">
      <div className="grid grid-cols-2 gap-ms-2 sm:grid-cols-3">
        {OPTIONS.map((o) => {
          const active = pref === o.id;
          const Icon = o.Icon;
          return (
            <Button
              key={o.id}
              type="button"
              variant={active ? "default" : "outline"}
              className="h-auto flex-col items-start gap-0.5 px-ms-3 py-ms-2 text-left"
              aria-pressed={active}
              onClick={() => choose(o.id)}
            >
              <span className="flex items-center gap-ms-1 text-ms-sm font-medium">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{o.label}</span>
              </span>
              <span className="text-ms-2xs opacity-80">{o.hint}</span>
            </Button>
          );
        })}
      </div>
      <div className="space-ms-2 rounded-lg border border-border/60 p-ms-3">
        <p className="text-ms-sm font-medium">Perilaku scroll</p>
        <div className="space-ms-1">
          <p className="text-ms-2xs text-muted-foreground">
            Jarak gulir sebelum mode “Saat scroll” aktif
          </p>
          <div className="grid grid-cols-3 gap-ms-2">
            {THRESHOLDS.map((t) => (
              <Button
                key={t.value}
                type="button"
                size="sm"
                variant={scroll.threshold === t.value ? "default" : "outline"}
                aria-pressed={scroll.threshold === t.value}
                onClick={() => patchScroll({ threshold: t.value })}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-ms-3">
          <Label htmlFor="fs-scroll-down" className="text-ms-xs font-normal">
            Hanya saat gulir ke bawah
            <span className="block text-ms-2xs text-muted-foreground">
              Gulir ke atas tidak memicu layar penuh
            </span>
          </Label>
          <Switch
            id="fs-scroll-down"
            checked={scroll.direction === "down"}
            onCheckedChange={(v) => patchScroll({ direction: v ? "down" : "any" })}
          />
        </div>
        <div className="flex items-center justify-between gap-ms-3">
          <Label htmlFor="fs-scroll-freeze" className="text-ms-xs font-normal">
            Tahan posisi saat transisi
            <span className="block text-ms-2xs text-muted-foreground">
              Halaman tidak meloncat ketika layar penuh menyala
            </span>
          </Label>
          <Switch
            id="fs-scroll-freeze"
            checked={scroll.freezeOnEnter}
            onCheckedChange={(v) => patchScroll({ freezeOnEnter: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-ms-3">
          <Label htmlFor="fs-scroll-lock" className="text-ms-xs font-normal">
            Kunci scroll (tanpa bounce)
            <span className="block text-ms-2xs text-muted-foreground">
              Cegah bilah sistem muncul saat gulir melewati ujung konten
            </span>
          </Label>
          <Switch
            id="fs-scroll-lock"
            checked={scroll.lockOverscroll}
            onCheckedChange={(v) => patchScroll({ lockOverscroll: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-ms-3">
          <Label htmlFor="fs-scroll-smooth" className="text-ms-xs font-normal">
            Scroll halus
            <span className="block text-ms-2xs text-muted-foreground">
              Animasi lembut saat berpindah bagian
            </span>
          </Label>
          <Switch
            id="fs-scroll-smooth"
            checked={scroll.smoothScroll}
            onCheckedChange={(v) => patchScroll({ smoothScroll: v })}
          />
        </div>
      </div>
      <p className="text-ms-2xs text-muted-foreground">
        Status sekarang: <strong>{mode}</strong>.{" "}
        {installed
          ? "Aplikasi berjalan tanpa bilah alamat, jadi layar sudah penuh tanpa header ganda."
          : supported
            ? "Pilih “Layar penuh” untuk menyembunyikan bilah sistem di Android."
            : "Di iPhone/iPad, pasang aplikasi lewat Bagikan → Tambahkan ke Layar Utama untuk layar penuh."}
      </p>
    </div>
  );
}

export default FullscreenModeToggle;
