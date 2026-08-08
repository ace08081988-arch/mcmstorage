import { useEffect, useState } from "react";
import { Maximize, Minimize, MousePointerClick, Rocket, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  applyDisplayMode,
  applyFullscreenPref,
  canRequestFullscreen,
  currentDisplayMode,
  readFullscreenPref,
  writeFullscreenPref,
  type FullscreenPref,
} from "@/lib/fullscreen-mode";

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
  const supported = canRequestFullscreen();

  useEffect(() => {
    setPref(readFullscreenPref());
    setMode(currentDisplayMode());
    const sync = () => setMode(currentDisplayMode());
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

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
