import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { RotateCcw, Sparkles, Sun, Moon, Monitor, Palette, Type, Image as ImageIcon, Layers, Languages, Accessibility, Download, Upload, Check, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import {
  applyAppearance,
  ACCENTS,
  BG_PRESETS,
  LS,
} from "@/components/appearance-settings";
import { useAppPrefs, setAppPrefs } from "@/lib/app-prefs";
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

// ============================================================================
// Skema ekspor/impor pengaturan tampilan
// ----------------------------------------------------------------------------
// SCHEMA_VERSION dinaikkan setiap kali struktur berubah tidak-kompatibel.
// Impor selalu backward-compatible: field yang belum dikenal diabaikan, field
// yang hilang di file lama diisi dari draft saat ini (fallback aman), dan file
// dengan versi lebih baru tetap dicoba muat sebisanya sambil memberi peringatan.
// ============================================================================
const EXPORT_SCHEMA_TYPE = "mcm.appearance-settings";
const EXPORT_SCHEMA_VERSION = 2;
const APPEARANCE_APP_ID = "mcm-storage";

const VALID_THEMES: readonly Theme[] = ["light", "dark", "system"];
const VALID_FONTS: readonly FontFamily[] = ["sans", "serif", "mono", "display"];
const VALID_SIZES: readonly FontSize[] = ["sm", "md", "lg", "xl"];

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function pickEnum<T extends string>(
  x: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof x === "string" && (allowed as readonly string[]).includes(x)
    ? (x as T)
    : fallback;
}
function pickNumber(x: unknown, fallback: number, min?: number, max?: number): number {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return fallback;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}
function pickBool(x: unknown, fallback: boolean): boolean {
  return typeof x === "boolean" ? x : fallback;
}
function pickString(x: unknown, fallback: string): string {
  return typeof x === "string" ? x : fallback;
}

type ImportedPatch = {
  theme: Theme;
  font: FontFamily;
  size: FontSize;
  accent: string;
  radius: number;
  bgImage: string;
  bgOverlay: number;
  bgBlur: number;
  compact: boolean;
  fontScale: number;
  highContrast: boolean;
  reduceMotion: boolean;
};

type MigrateResult =
  | { ok: true; patch: ImportedPatch; forward: boolean; fromVersion: number }
  | { ok: false; reason: "unknown_type" | "invalid" };

/**
 * Terima payload apa pun dari file ekspor lama/baru dan kembalikan patch
 * pratinjau yang aman untuk digabung ke draft. Cocok untuk semua rilis yang
 * memakai skema `mcm.appearance-settings`.
 */
function migrateImportedAppearance(
  raw: unknown,
  current: ImportedPatch,
): MigrateResult {
  if (!isRecord(raw)) return { ok: false, reason: "invalid" };
  if (raw.__type !== EXPORT_SCHEMA_TYPE) {
    return { ok: false, reason: "unknown_type" };
  }
  const fromVersion = Number(
    raw.schemaVersion ?? raw.version ?? 1,
  );
  const forward = Number.isFinite(fromVersion) && fromVersion > EXPORT_SCHEMA_VERSION;

  // Field appearance dapat berada di root (skema v1) atau di dalam
  // `appearance` (skema ≥1). Ambil dari mana pun tersedia.
  const ap: Record<string, unknown> = isRecord(raw.appearance)
    ? (raw.appearance as Record<string, unknown>)
    : {};
  const ap2: Record<string, unknown> = isRecord(raw.appPrefs)
    ? (raw.appPrefs as Record<string, unknown>)
    : {};

  const patch: ImportedPatch = {
    theme: pickEnum(ap.theme ?? raw.theme, VALID_THEMES, current.theme),
    font: pickEnum(ap.font ?? raw.font, VALID_FONTS, current.font),
    size: pickEnum(ap.size ?? raw.size, VALID_SIZES, current.size),
    accent: pickString(ap.accent ?? raw.accent, current.accent),
    radius: pickNumber(ap.radius ?? raw.radius, current.radius, 0, 2),
    bgImage: pickString(ap.bgImage ?? raw.bgImage, current.bgImage),
    bgOverlay: pickNumber(ap.bgOverlay ?? raw.bgOverlay, current.bgOverlay, 0, 1),
    bgBlur: pickNumber(ap.bgBlur ?? raw.bgBlur, current.bgBlur, 0, 40),
    compact: pickBool(raw.compact, current.compact),
    fontScale: pickNumber(ap2.fontScale ?? raw.fontScale, current.fontScale, 0.8, 1.5),
    highContrast: pickBool(
      ap2.highContrast ?? raw.highContrast,
      current.highContrast,
    ),
    reduceMotion: pickBool(
      ap2.reduceMotion ?? raw.reduceMotion,
      current.reduceMotion,
    ),
  };

  return { ok: true, patch, forward, fromVersion };
}

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


type Draft = {
  theme: Theme;
  font: FontFamily;
  size: FontSize;
  accent: string;
  radius: number;
  bgImage: string;
  bgOverlay: number;
  bgBlur: number;
  compact: boolean;
  fontScale: number;
  highContrast: boolean;
  reduceMotion: boolean;
};

function resolveThemeLocal(t: Theme): "light" | "dark" {
  if (t === "system") {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return t;
}

/** Terapkan draft ke <html> TANPA menulis localStorage. */
function applyDraftDom(v: Draft) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolveThemeLocal(v.theme) === "dark");
  root.dataset.font = v.font;
  root.dataset.fontSize = v.size;
  const acc = ACCENTS.find((a) => a.id === v.accent) ?? ACCENTS[0];
  root.style.setProperty("--primary", acc.value);
  root.style.setProperty("--ring", acc.value);
  root.style.setProperty("--primary-foreground", "oklch(0.985 0 0)");
  root.style.setProperty("--radius", `${v.radius}rem`);
  root.style.setProperty(
    "--app-bg-image",
    v.bgImage ? `url("${v.bgImage.replace(/"/g, '\\"')}")` : "none",
  );
  root.style.setProperty("--app-bg-overlay", String(v.bgImage ? v.bgOverlay : 1));
  root.style.setProperty("--app-bg-blur", `${v.bgImage ? v.bgBlur : 0}px`);
  if (v.bgImage) root.dataset.hasBg = "1";
  else delete root.dataset.hasBg;
  root.classList.toggle("compact", v.compact);
  root.style.setProperty("--app-font-scale", String(v.fontScale));
  root.dataset.highContrast = v.highContrast ? "on" : "off";
  root.dataset.reduceMotion = v.reduceMotion ? "on" : "off";
}

function readSnapshot(prefsSeed: { fontScale: number; highContrast: boolean; reduceMotion: boolean }): Draft {
  if (typeof window === "undefined") {
    return {
      theme: "dark", font: "sans", size: "md", accent: "emerald",
      radius: 0.625, bgImage: "", bgOverlay: 0.7, bgBlur: 0,
      compact: true, fontScale: 1, highContrast: false, reduceMotion: false,
    };
  }
  return {
    theme: readTheme(),
    font: readFont(),
    size: readSize(),
    accent: localStorage.getItem(LS.accent) ?? "emerald",
    radius: Number(localStorage.getItem(LS.radius) ?? "0.625"),
    bgImage: localStorage.getItem(LS.bgImage) ?? "",
    bgOverlay: Number(localStorage.getItem(LS.bgOverlay) ?? "0.7"),
    bgBlur: Number(localStorage.getItem(LS.bgBlur) ?? "0"),
    compact: readCompact(),
    fontScale: prefsSeed.fontScale,
    highContrast: prefsSeed.highContrast,
    reduceMotion: prefsSeed.reduceMotion,
  };
}

const DEFAULT_DRAFT: Draft = {
  theme: "dark",
  font: "sans",
  size: "md",
  accent: "emerald",
  radius: 0.625,
  bgImage: "",
  bgOverlay: 0.7,
  bgBlur: 0,
  compact: false,
  fontScale: 1,
  highContrast: false,
  reduceMotion: false,
};

function draftsEqual(a: Draft, b: Draft): boolean {
  return (
    a.theme === b.theme &&
    a.font === b.font &&
    a.size === b.size &&
    a.accent === b.accent &&
    a.radius === b.radius &&
    a.bgImage === b.bgImage &&
    a.bgOverlay === b.bgOverlay &&
    a.bgBlur === b.bgBlur &&
    a.compact === b.compact &&
    a.fontScale === b.fontScale &&
    a.highContrast === b.highContrast &&
    a.reduceMotion === b.reduceMotion
  );
}

function PengaturanTampilanPage() {
  const { prefs } = useAppPrefs();

  // Snapshot dari nilai yang tersimpan saat halaman dibuka.
  // Dipakai untuk revert saat "Batalkan" atau keluar tanpa Simpan.
  const [snapshot, setSnapshot] = useState<Draft>(() =>
    readSnapshot({
      fontScale: prefs.fontScale,
      highContrast: prefs.highContrast,
      reduceMotion: prefs.reduceMotion,
    }),
  );

  // Draft yang sedang dipratinjau (belum disimpan).
  const [draft, setDraft] = useState<Draft>(snapshot);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef(false);
  const snapshotRef = useRef<Draft>(snapshot);
  snapshotRef.current = snapshot;

  // Terapkan draft ke DOM setiap kali berubah — hanya visual, tanpa persist.
  useEffect(() => {
    applyDraftDom(draft);
  }, [draft]);

  // Kalau user meninggalkan halaman tanpa Simpan, kembalikan tampilan
  // aplikasi utama ke snapshot terakhir yang tersimpan.
  useEffect(() => {
    return () => {
      if (!savedRef.current) {
        applyDraftDom(snapshotRef.current);
      }
    };
  }, []);

  const dirty = useMemo(() => !draftsEqual(draft, snapshot), [draft, snapshot]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const applyPreset = (p: Preset) => {
    patch({
      theme: p.values.theme,
      accent: p.values.accent,
      radius: p.values.radius,
      font: p.values.font,
      size: p.values.size,
      compact: p.values.compact,
      fontScale: p.values.fontScale,
    });
    toast.success(`Preset "${p.label}" dipratinjau`, {
      description: `${p.desc} — tekan Simpan untuk menerapkan.`,
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
      patch({ bgImage: url });
    };
    reader.readAsDataURL(file);
  };

  const resetAll = () => {
    setDraft(DEFAULT_DRAFT);
    toast.info("Draft direset ke bawaan — tekan Simpan untuk menerapkan.");
  };

  const commitSave = () => {
    // Persist appearance-* LS
    localStorage.setItem(LS.theme, draft.theme);
    localStorage.setItem(LS.font, draft.font);
    localStorage.setItem(LS.size, draft.size);
    localStorage.setItem(LS.accent, draft.accent);
    localStorage.setItem(LS.radius, String(draft.radius));
    if (draft.bgImage) localStorage.setItem(LS.bgImage, draft.bgImage);
    else localStorage.removeItem(LS.bgImage);
    localStorage.setItem(LS.bgOverlay, String(draft.bgOverlay));
    localStorage.setItem(LS.bgBlur, String(draft.bgBlur));
    applyAppearance();

    // Compact + app-prefs
    writeCompact(draft.compact);
    setAppPrefs({
      fontScale: draft.fontScale,
      highContrast: draft.highContrast,
      reduceMotion: draft.reduceMotion,
    });

    savedRef.current = true;
    setSnapshot(draft);
    // Izinkan draft berikutnya kembali di-revert saat unmount.
    setTimeout(() => { savedRef.current = false; }, 0);
    toast.success("Pengaturan tampilan disimpan");
  };

  const commitCancel = () => {
    setDraft(snapshot);
    toast.info("Perubahan dibatalkan");
  };

  const exportSettings = () => {
    try {
      const payload = {
        __type: "mcm.appearance-settings",
        version: 1,
        exportedAt: new Date().toISOString(),
        appearance: {
          theme: draft.theme,
          font: draft.font,
          size: draft.size,
          accent: draft.accent,
          radius: String(draft.radius),
          bgImage: draft.bgImage,
          bgOverlay: String(draft.bgOverlay),
          bgBlur: String(draft.bgBlur),
        },
        compact: draft.compact,
        appPrefs: {
          fontScale: draft.fontScale,
          highContrast: draft.highContrast,
          reduceMotion: draft.reduceMotion,
        },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `mcm-pengaturan-tampilan-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Pengaturan tampilan diekspor");
    } catch {
      toast.error("Gagal mengekspor pengaturan");
    }
  };

  const importSettings = (file: File | null) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File terlalu besar (maks 10MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result ?? "{}"));
        if (!data || data.__type !== "mcm.appearance-settings") {
          toast.error("File tidak dikenali sebagai pengaturan tampilan MCM.");
          return;
        }
        const ap = data.appearance ?? {};
        const ap2 = data.appPrefs ?? {};
        setDraft((d) => ({
          ...d,
          theme: (ap.theme as Theme) ?? d.theme,
          font: (ap.font as FontFamily) ?? d.font,
          size: (ap.size as FontSize) ?? d.size,
          accent: ap.accent ?? d.accent,
          radius: Number.isFinite(Number(ap.radius)) ? Number(ap.radius) : d.radius,
          bgImage: typeof ap.bgImage === "string" ? ap.bgImage : d.bgImage,
          bgOverlay: Number.isFinite(Number(ap.bgOverlay)) ? Number(ap.bgOverlay) : d.bgOverlay,
          bgBlur: Number.isFinite(Number(ap.bgBlur)) ? Number(ap.bgBlur) : d.bgBlur,
          compact: typeof data.compact === "boolean" ? data.compact : d.compact,
          fontScale: Number.isFinite(Number(ap2.fontScale)) ? Number(ap2.fontScale) : d.fontScale,
          highContrast: typeof ap2.highContrast === "boolean" ? ap2.highContrast : d.highContrast,
          reduceMotion: typeof ap2.reduceMotion === "boolean" ? ap2.reduceMotion : d.reduceMotion,
        }));
        toast.success("Pengaturan diimpor — tekan Simpan untuk menerapkan.");
      } catch {
        toast.error("File tidak valid atau rusak.");
      } finally {
        if (importInputRef.current) importInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-32">
      <SettingsHeader title="Tampilan" subtitle="Preset, tema, aksen, font, latar & kerapatan" />

      <div className="space-y-4 px-4 pt-2">
        {/* Info draft */}
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
          Perubahan di halaman ini adalah <span className="font-semibold text-foreground">pratinjau</span>.
          Tampilan halaman lain tidak berubah sampai Anda menekan{" "}
          <span className="font-semibold text-foreground">Simpan</span> di bagian bawah.
        </div>

        {/* Preset profesional */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> Preset profesional
            </CardTitle>
            <CardDescription className="text-xs">
              Satu klik untuk mempratinjau tema, aksen, radius, font, dan kerapatan sekaligus.
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
                  onClick={() => patch({ theme: v })}
                  className={`flex flex-col items-center gap-1 rounded-md border px-2 py-3 text-xs font-medium transition-all hover:bg-accent active:scale-[0.97] ${draft.theme === v ? "border-primary bg-accent" : ""}`}
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
                  onClick={() => patch({ accent: a.id })}
                  title={a.label}
                  aria-label={a.label}
                  className={`relative h-9 w-9 rounded-full border-2 transition-transform active:scale-90 ${draft.accent === a.id ? "border-foreground ring-2 ring-primary/50 ring-offset-2 ring-offset-background" : "border-transparent"}`}
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
                    onClick={() => patch({ font: o.v })}
                    style={{ fontFamily: o.family }}
                    className={`rounded-md border px-2 py-2 text-left text-xs font-medium hover:bg-accent active:scale-[0.97] transition-transform ${draft.font === o.v ? "border-primary bg-accent" : ""}`}
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
                    onClick={() => patch({ size: o.v })}
                    className={`rounded-md border px-2 py-2 text-sm font-semibold hover:bg-accent active:scale-[0.97] transition-transform ${draft.size === o.v ? "border-primary bg-accent" : ""}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Skala font (in-app)</p>
                <span className="text-xs font-semibold tabular-nums">{Math.round(draft.fontScale * 100)}%</span>
              </div>
              <Slider
                value={[draft.fontScale]}
                min={0.9}
                max={1.4}
                step={0.05}
                onValueChange={(v) => patch({ fontScale: v[0] ?? 1 })}
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
                checked={draft.compact}
                onCheckedChange={(v) => patch({ compact: v })}
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Kelengkungan sudut</p>
                <span className="text-xs font-semibold tabular-nums">{draft.radius.toFixed(2)}rem</span>
              </div>
              <Slider
                value={[draft.radius]}
                min={0}
                max={1.5}
                step={0.05}
                onValueChange={(v) => patch({ radius: v[0] ?? 0.625 })}
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
                checked={draft.reduceMotion}
                onCheckedChange={(v) => patch({ reduceMotion: v })}
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
                checked={draft.highContrast}
                onCheckedChange={(v) => patch({ highContrast: v })}
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
                  backgroundImage: draft.bgImage ? `url("${draft.bgImage}")` : undefined,
                  backgroundColor: draft.bgImage ? undefined : "var(--muted)",
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  filter: draft.bgImage ? `blur(${draft.bgBlur}px)` : undefined,
                  transform: "scale(1.06)",
                }}
              />
              {draft.bgImage && (
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    background: `color-mix(in oklab, var(--background) ${Math.round(draft.bgOverlay * 100)}%, transparent)`,
                  }}
                />
              )}
              <div className="absolute inset-0 flex items-center justify-center text-center">
                <p className="text-xs font-semibold text-foreground">
                  {draft.bgImage ? `Overlay ${Math.round(draft.bgOverlay * 100)}%, blur ${draft.bgBlur}px` : "Belum ada foto latar"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {BG_PRESETS.map((p) => {
                const active = (p.url === "" && !draft.bgImage) || draft.bgImage === p.url;
                return (
                  <button
                    key={p.id}
                    onClick={() => patch({ bgImage: p.url })}
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
              {draft.bgImage && (
                <button
                  onClick={() => patch({ bgImage: "" })}
                  className="rounded-md border px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  Hapus latar
                </button>
              )}
            </div>

            {draft.bgImage && (
              <>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Transparansi (overlay)</p>
                    <span className="text-xs font-semibold tabular-nums">{Math.round(draft.bgOverlay * 100)}%</span>
                  </div>
                  <Slider
                    value={[draft.bgOverlay]}
                    min={0}
                    max={0.95}
                    step={0.05}
                    onValueChange={(v) => patch({ bgOverlay: v[0] ?? 0.7 })}
                    aria-label="Kegelapan overlay latar"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    0% = foto sepenuhnya tembus; 95% = hampir tak terlihat.
                  </p>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Blur foto</p>
                    <span className="text-xs font-semibold tabular-nums">{draft.bgBlur}px</span>
                  </div>
                  <Slider
                    value={[draft.bgBlur]}
                    min={0}
                    max={20}
                    step={1}
                    onValueChange={(v) => patch({ bgBlur: v[0] ?? 0 })}
                    aria-label="Blur foto latar"
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Ekspor & impor */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4" /> Ekspor & impor pengaturan
            </CardTitle>
            <CardDescription className="text-xs">
              Simpan semua pengaturan di halaman ini (tema, aksen, font, ukuran, skala,
              kerapatan, radius, kontras, animasi, dan latar) menjadi satu file.
              Berguna untuk memindahkan tampilan yang sudah Anda atur ke HP/laptop
              lain, atau membagikannya ke rekan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={exportSettings}
                className="flex items-start gap-3 rounded-md border p-3 text-left hover:bg-accent transition-transform active:scale-[0.98]"
              >
                <Download className="h-4 w-4 mt-0.5 text-primary" />
                <div>
                  <p className="text-sm font-semibold">Ekspor ke file</p>
                  <p className="text-[11px] text-muted-foreground">
                    Unduh file <code className="rounded bg-muted px-1">.json</code> berisi
                    pengaturan tampilan Anda saat ini.
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex items-start gap-3 rounded-md border p-3 text-left hover:bg-accent transition-transform active:scale-[0.98]"
              >
                <Upload className="h-4 w-4 mt-0.5 text-primary" />
                <div>
                  <p className="text-sm font-semibold">Impor dari file</p>
                  <p className="text-[11px] text-muted-foreground">
                    Pilih file hasil ekspor untuk memuatnya sebagai pratinjau.
                  </p>
                </div>
              </button>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Hasil impor hanya menimpa pratinjau di halaman ini — data akun, chat, dan
              gudang tidak terpengaruh. Tekan <span className="font-semibold text-foreground">Simpan</span>{" "}
              agar hasilnya diterapkan ke aplikasi.
            </p>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => importSettings(e.target.files?.[0] ?? null)}
            />
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

      {/* Sticky action bar — muncul saat ada perubahan belum disimpan */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur transition-transform ${dirty ? "translate-y-0" : "translate-y-full"}`}
        role="region"
        aria-label="Simpan pengaturan tampilan"
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Ada perubahan belum disimpan. Tampilan aplikasi utama belum berubah.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={commitCancel}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Batalkan
            </Button>
            <Button size="sm" onClick={commitSave}>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Simpan
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
