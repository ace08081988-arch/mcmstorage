import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
import { RotateCcw, Sparkles, Sun, Moon, Monitor, Palette, Type, Image as ImageIcon, Layers, Languages, Accessibility } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import {
  applyAppearance,
  ACCENTS,
  BG_PRESETS,
  LS,
} from "@/components/appearance-settings";
import { useAppPrefs } from "@/lib/app-prefs";
import { COMPACT_MODE_EVENT } from "@/components/CompactModeToggle";

const COMPACT_LS = "app-compact-mode";
function readCompact(): boolean {
  if (typeof window === "undefined") return false;
  const raw = localStorage.getItem(COMPACT_LS);
  return raw == null ? true : raw === "1";
}
function writeCompact(v: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(COMPACT_LS, v ? "1" : "0");
  document.documentElement.classList.toggle("compact", v);
  try { window.dispatchEvent(new CustomEvent(COMPACT_MODE_EVENT, { detail: { on: v } })); } catch { /* ignore */ }
}

type Theme = "light" | "dark" | "system";
type FontFamily = "sans" | "serif" | "mono" | "display";
type FontSize = "sm" | "md" | "lg" | "xl";

export const Route = createFileRoute("/_authenticated/pengaturan-tampilan")({
  head: () => ({
    meta: [
      { title: "Tampilan · Pengaturan MCM" },
      { name: "description", content: "Atur tema, aksen, font, kerapatan, latar, dan preset tampilan profesional." },
    ],
  }),
  component: PengaturanTampilanPage,
});

type Preset = {
  id: string;
  label: string;
  desc: string;
  icon: string;
  values: {
    theme: Theme;
    accent: string;
    radius: number;
    font: FontFamily;
    size: FontSize;
    compact: boolean;
    fontScale: number;
  };
};

const PRESETS: Preset[] = [
  {
    id: "klasik",
    label: "Klasik",
    desc: "Serif elegan, sudut halus, aksen netral",
    icon: "📜",
    values: {
      theme: "light",
      accent: "slate",
      radius: 0.375,
      font: "serif",
      size: "md",
      compact: false,
      fontScale: 1,
    },
  },
  {
    id: "modern",
    label: "Modern",
    desc: "Display font, sudut lebar, aksen hijau",
    icon: "✨",
    values: {
      theme: "dark",
      accent: "emerald",
      radius: 0.875,
      font: "display",
      size: "md",
      compact: false,
      fontScale: 1,
    },
  },
  {
    id: "fokus",
    label: "Fokus",
    desc: "Padat, minim distraksi, aksen biru",
    icon: "🎯",
    values: {
      theme: "light",
      accent: "blue",
      radius: 0.5,
      font: "sans",
      size: "sm",
      compact: true,
      fontScale: 0.95,
    },
  },
];

function readTheme(): Theme {
  return (typeof window !== "undefined"
    ? ((localStorage.getItem(LS.theme) as Theme | null) ?? "dark")
    : "dark");
}
function readFont(): FontFamily {
  return (typeof window !== "undefined"
    ? ((localStorage.getItem(LS.font) as FontFamily | null) ?? "sans")
    : "sans");
}
function readSize(): FontSize {
  return (typeof window !== "undefined"
    ? ((localStorage.getItem(LS.size) as FontSize | null) ?? "md")
    : "md");
}

function PengaturanTampilanPage() {
  const { prefs, set } = useAppPrefs();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [font, setFont] = useState<FontFamily>(readFont);
  const [size, setSize] = useState<FontSize>(readSize);
  const [accent, setAccent] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem(LS.accent) ?? "emerald" : "emerald",
  );
  const [radius, setRadius] = useState<number>(() =>
    typeof window !== "undefined" ? Number(localStorage.getItem(LS.radius) ?? "0.625") : 0.625,
  );
  const [bgImage, setBgImage] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem(LS.bgImage) ?? "" : "",
  );
  const [bgOverlay, setBgOverlay] = useState<number>(() =>
    typeof window !== "undefined" ? Number(localStorage.getItem(LS.bgOverlay) ?? "0.7") : 0.7,
  );
  const [bgBlur, setBgBlur] = useState<number>(() =>
    typeof window !== "undefined" ? Number(localStorage.getItem(LS.bgBlur) ?? "0") : 0,
  );
  const [compact, setCompact] = useState<boolean>(() => readCompact());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const save = (k: string, v: string) => {
    localStorage.setItem(k, v);
    applyAppearance();
  };

  const applyPreset = (p: Preset) => {
    localStorage.setItem(LS.theme, p.values.theme);
    localStorage.setItem(LS.accent, p.values.accent);
    localStorage.setItem(LS.radius, String(p.values.radius));
    localStorage.setItem(LS.font, p.values.font);
    localStorage.setItem(LS.size, p.values.size);
    setTheme(p.values.theme);
    setAccent(p.values.accent);
    setRadius(p.values.radius);
    setFont(p.values.font);
    setSize(p.values.size);
    applyAppearance();
    // Density + font scale via app-prefs / compact-mode
    setCompact(p.values.compact);
    writeCompact(p.values.compact);
    set({ fontScale: p.values.fontScale });
    toast.success(`Preset "${p.label}" diterapkan`, {
      description: p.desc,
    });
  };

  const onPickFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Ukuran foto maksimal 4MB. Pilih foto lain.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      setBgImage(url);
      save(LS.bgImage, url);
      toast.success("Latar diperbarui");
    };
    reader.readAsDataURL(file);
  };

  const resetAll = () => {
    [
      LS.theme, LS.font, LS.size, LS.accent, LS.radius,
      LS.bgImage, LS.bgOverlay, LS.bgBlur,
    ].forEach((k) => localStorage.removeItem(k));
    applyAppearance();
    setTheme("dark"); setFont("sans"); setSize("md");
    setAccent("emerald"); setRadius(0.625);
    setBgImage(""); setBgOverlay(0.7); setBgBlur(0);
    setCompact(false); writeCompact(false);
    set({ fontScale: 1 });
    toast.success("Tampilan dikembalikan ke bawaan");
  };

  useEffect(() => {
    // Refresh state saat kembali ke tab
    const on = () => {
      setTheme(readTheme()); setFont(readFont()); setSize(readSize());
    };
    window.addEventListener("focus", on);
    return () => window.removeEventListener("focus", on);
  }, []);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-10">
      <SettingsHeader title="Tampilan" subtitle="Preset, tema, aksen, font, latar & kerapatan" />

      <div className="space-y-4 px-4 pt-2">
        {/* Preset profesional */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> Preset profesional
            </CardTitle>
            <CardDescription className="text-xs">
              Satu klik untuk mengubah tema, aksen, radius, font, dan kerapatan sekaligus.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="group flex flex-col gap-1 rounded-lg border bg-card px-3 py-3 text-left transition-all duration-150 hover:border-primary/50 hover:bg-accent active:scale-[0.98]"
              >
                <span className="text-lg leading-none">{p.icon}</span>
                <span className="text-sm font-semibold">{p.label}</span>
                <span className="text-[11px] leading-snug text-muted-foreground">{p.desc}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Tema */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Moon className="h-4 w-4" /> Tema
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2">
              {([
                { v: "light" as Theme, label: "Terang", Icon: Sun },
                { v: "dark" as Theme, label: "Gelap", Icon: Moon },
                { v: "system" as Theme, label: "Sistem", Icon: Monitor },
              ]).map(({ v, label, Icon }) => (
                <button
                  key={v}
                  onClick={() => { setTheme(v); save(LS.theme, v); }}
                  className={`flex flex-col items-center gap-1 rounded-md border px-2 py-3 text-xs font-medium transition-all hover:bg-accent active:scale-[0.97] ${theme === v ? "border-primary bg-accent" : ""}`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Aksen */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4" /> Warna aksen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2.5">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => { setAccent(a.id); save(LS.accent, a.id); }}
                  title={a.label}
                  aria-label={a.label}
                  className={`relative h-9 w-9 rounded-full border-2 transition-transform active:scale-90 ${accent === a.id ? "border-foreground ring-2 ring-primary/50 ring-offset-2 ring-offset-background" : "border-transparent"}`}
                  style={{ backgroundColor: a.swatch }}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Font */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Type className="h-4 w-4" /> Font & ukuran
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Jenis font</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { v: "sans" as FontFamily, label: "Sans (Inter)", family: "Inter, system-ui, sans-serif" },
                  { v: "serif" as FontFamily, label: "Serif (Merriweather)", family: "Merriweather, Georgia, serif" },
                  { v: "mono" as FontFamily, label: "Mono (JetBrains)", family: "'JetBrains Mono', monospace" },
                  { v: "display" as FontFamily, label: "Display (Space Grotesk)", family: "'Space Grotesk', sans-serif" },
                ]).map((o) => (
                  <button
                    key={o.v}
                    onClick={() => { setFont(o.v); save(LS.font, o.v); }}
                    style={{ fontFamily: o.family }}
                    className={`rounded-md border px-2 py-2 text-left text-xs font-medium hover:bg-accent active:scale-[0.97] transition-transform ${font === o.v ? "border-primary bg-accent" : ""}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs text-muted-foreground">Ukuran teks</p>
              <div className="grid grid-cols-4 gap-2">
                {([
                  { v: "sm" as FontSize, label: "A−" },
                  { v: "md" as FontSize, label: "A" },
                  { v: "lg" as FontSize, label: "A+" },
                  { v: "xl" as FontSize, label: "A++" },
                ]).map((o) => (
                  <button
                    key={o.v}
                    onClick={() => { setSize(o.v); save(LS.size, o.v); }}
                    className={`rounded-md border px-2 py-2 text-sm font-semibold hover:bg-accent active:scale-[0.97] transition-transform ${size === o.v ? "border-primary bg-accent" : ""}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Skala font (in-app)</p>
                <span className="text-xs font-semibold tabular-nums">{Math.round(prefs.fontScale * 100)}%</span>
              </div>
              <Slider
                value={[prefs.fontScale]}
                min={0.9}
                max={1.4}
                step={0.05}
                onValueChange={(v) => set({ fontScale: v[0] ?? 1 })}
                aria-label="Skala font"
              />
            </div>
          </CardContent>
        </Card>

        {/* Kerapatan & sudut */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" /> Kerapatan & sudut
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Mode padat (compact)</p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Rapatkan padding & jarak agar lebih banyak konten terlihat.
                </p>
              </div>
              <Switch
                checked={compact}
                onCheckedChange={(v) => { setCompact(v); writeCompact(v); }}
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Kelengkungan sudut</p>
                <span className="text-xs font-semibold tabular-nums">{radius.toFixed(2)}rem</span>
              </div>
              <Slider
                value={[radius]}
                min={0}
                max={1.5}
                step={0.05}
                onValueChange={(v) => {
                  const n = v[0] ?? 0.625;
                  setRadius(n);
                  save(LS.radius, String(n));
                }}
                aria-label="Kelengkungan sudut"
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Kurangi animasi</p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Hilangkan animasi non-esensial untuk tampilan lebih tenang.
                </p>
              </div>
              <Switch
                checked={prefs.reduceMotion}
                onCheckedChange={(v) => set({ reduceMotion: v })}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Tingkatkan kontras</p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Perkuat border & ring fokus.
                </p>
              </div>
              <Switch
                checked={prefs.highContrast}
                onCheckedChange={(v) => set({ highContrast: v })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Latar & transparansi */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="h-4 w-4" /> Latar & transparansi
            </CardTitle>
            <CardDescription className="text-xs">
              Pilih preset, unggah foto sendiri, dan atur kegelapan/blur overlay.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Pratinjau */}
            <div className="relative h-32 w-full overflow-hidden rounded-md border">
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  backgroundImage: bgImage ? `url("${bgImage}")` : undefined,
                  backgroundColor: bgImage ? undefined : "var(--muted)",
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  filter: bgImage ? `blur(${bgBlur}px)` : undefined,
                  transform: "scale(1.06)",
                }}
              />
              {bgImage && (
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    background: `color-mix(in oklab, var(--background) ${Math.round(bgOverlay * 100)}%, transparent)`,
                  }}
                />
              )}
              <div className="absolute inset-0 flex items-center justify-center text-center">
                <p className="text-xs font-semibold text-foreground">
                  {bgImage ? `Overlay ${Math.round(bgOverlay * 100)}%, blur ${bgBlur}px` : "Belum ada foto latar"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {BG_PRESETS.map((p) => {
                const active = (p.url === "" && !bgImage) || bgImage === p.url;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setBgImage(p.url);
                      if (p.url) save(LS.bgImage, p.url);
                      else { localStorage.removeItem(LS.bgImage); applyAppearance(); }
                    }}
                    className={`relative h-14 overflow-hidden rounded-md border text-[10px] font-medium transition-transform hover:opacity-90 active:scale-95 ${active ? "border-primary ring-2 ring-primary" : "border-muted"}`}
                    style={p.url ? { backgroundImage: `url("${p.url}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                    title={p.label}
                  >
                    <span className="absolute inset-x-0 bottom-0 bg-black/50 px-1 py-0.5 text-white">
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="inline-flex flex-1 cursor-pointer items-center justify-center rounded-md border border-dashed px-3 py-2 text-xs font-medium hover:bg-accent">
                📷 Unggah foto sendiri
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {bgImage && (
                <button
                  onClick={() => {
                    setBgImage("");
                    localStorage.removeItem(LS.bgImage);
                    applyAppearance();
                    toast.success("Foto latar dihapus");
                  }}
                  className="rounded-md border px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  Hapus latar
                </button>
              )}
            </div>

            {bgImage && (
              <>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Transparansi (overlay)</p>
                    <span className="text-xs font-semibold tabular-nums">{Math.round(bgOverlay * 100)}%</span>
                  </div>
                  <Slider
                    value={[bgOverlay]}
                    min={0}
                    max={0.95}
                    step={0.05}
                    onValueChange={(v) => {
                      const n = v[0] ?? 0.7;
                      setBgOverlay(n);
                      save(LS.bgOverlay, String(n));
                    }}
                    aria-label="Kegelapan overlay latar"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    0% = foto sepenuhnya tembus; 95% = hampir tak terlihat.
                  </p>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Blur foto</p>
                    <span className="text-xs font-semibold tabular-nums">{bgBlur}px</span>
                  </div>
                  <Slider
                    value={[bgBlur]}
                    min={0}
                    max={20}
                    step={1}
                    onValueChange={(v) => {
                      const n = v[0] ?? 0;
                      setBgBlur(n);
                      save(LS.bgBlur, String(n));
                    }}
                    aria-label="Blur foto latar"
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Tautan pengaturan lanjutan */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pengaturan lain</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Link
              to="/pengaturan-bahasa"
              className="flex items-start gap-3 rounded-md border p-3 hover:bg-accent transition-transform active:scale-[0.98]"
            >
              <Languages className="h-4 w-4 mt-0.5 text-primary" />
              <div>
                <p className="text-sm font-semibold">Bahasa & format</p>
                <p className="text-[11px] text-muted-foreground">Bahasa aplikasi, mata uang, format tanggal</p>
              </div>
            </Link>
            <Link
              to="/pengaturan-aksesibilitas"
              className="flex items-start gap-3 rounded-md border p-3 hover:bg-accent transition-transform active:scale-[0.98]"
            >
              <Accessibility className="h-4 w-4 mt-0.5 text-primary" />
              <div>
                <p className="text-sm font-semibold">Aksesibilitas</p>
                <p className="text-[11px] text-muted-foreground">Skala teks lanjutan & animasi</p>
              </div>
            </Link>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={resetAll}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Kembalikan ke bawaan
          </Button>
        </div>
      </div>
    </main>
  );
}