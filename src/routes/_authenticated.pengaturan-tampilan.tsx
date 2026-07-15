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
import { RotateCcw, Sparkles, Sun, Moon, Monitor, Palette, Type, Image as ImageIcon, Layers, Languages, Accessibility, Download, Upload, Check, X, CheckCircle2, XCircle, ClipboardPaste, Link2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import {
  applyAppearance,
  ACCENTS,
  BG_PRESETS,
  LS,
} from "@/components/appearance-init";
import { useAppPrefs, setAppPrefs } from "@/lib/app-prefs";
import { COMPACT_MODE_EVENT } from "@/components/CompactModeToggle";
import {
  migrateImportedAppearance,
  EXPORT_SCHEMA_TYPE,
  EXPORT_SCHEMA_VERSION,
  APPEARANCE_APP_ID,
  type Theme,
  type FontFamily,
  type FontSize,
  type ImportedPatch,
  type MigrateResult,
} from "@/lib/appearance-migrator";
import {
  logAppearanceMigration,
  type ImportSource,
} from "@/lib/appearance-migrator.telemetry";

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
        __type: EXPORT_SCHEMA_TYPE,
        schemaVersion: EXPORT_SCHEMA_VERSION,
        // `version` dipertahankan untuk kompatibilitas importer versi lama
        // (rilis <=Q3-2026) yang membaca field `version` alih-alih `schemaVersion`.
        version: EXPORT_SCHEMA_VERSION,
        app: APPEARANCE_APP_ID,
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

  // ---------------------------------------------------------------
  // Jalur impor (upload/paste/URL) — SEMUA harus melewati satu-satunya
  // titik masuk `runImportFromText` di bawah, sehingga `migrateImportedAppearance`
  // adalah satu-satunya migrator dan tidak ada format lama yang di-parse
  // secara terpisah. Jangan tambahkan `JSON.parse` payload appearance di
  // tempat lain di file ini — tambahkan jalur baru sebagai wrapper tipis
  // yang memanggil helper ini.
  // ---------------------------------------------------------------
  const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

  const runImportFromText = (text: string, source: ImportSource) => {
    let data: unknown;
    try {
      data = JSON.parse(text || "{}");
    } catch {
      const invalid: MigrateResult = { ok: false, reason: "invalid" };
      logAppearanceMigration(source, invalid);
      toast.error(
        source === "url"
          ? "URL tidak berisi JSON yang valid."
          : "Teks tidak valid atau rusak.",
      );
      return;
    }
    setDraft((d) => {
      const result = migrateImportedAppearance(data, d);
      logAppearanceMigration(source, result);
      if (!result.ok) {
        if (result.reason === "unknown_type") {
          toast.error(
            `Payload tidak dikenali sebagai pengaturan tampilan MCM (${source}).`,
          );
        } else {
          toast.error(
            source === "url"
              ? "URL tidak berisi payload valid."
              : "Payload tidak valid atau rusak.",
          );
        }
        return d;
      }
      if (result.forward) {
        toast.warning(
          `Payload dari skema v${result.fromVersion} (lebih baru dari v${EXPORT_SCHEMA_VERSION}). Field yang dikenal dimuat; sisanya diabaikan.`,
        );
      } else {
        toast.success(
          `Pengaturan diimpor via ${source} (skema v${result.fromVersion}) — tekan Simpan untuk menerapkan.`,
        );
      }
      return { ...d, ...result.patch };
    });
  };

  const importSettings = (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error("File terlalu besar (maks 10MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        runImportFromText(String(reader.result ?? "{}"), "file");
      } finally {
        if (importInputRef.current) importInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  const importFromPaste = async () => {
    let text: string | null = null;
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.readText === "function"
      ) {
        text = await navigator.clipboard.readText();
      }
    } catch {
      // Izin clipboard ditolak atau tidak tersedia — jatuh ke prompt manual.
      text = null;
    }
    if (text == null || text.trim() === "") {
      const manual = window.prompt(
        "Tempel JSON pengaturan tampilan MCM di sini:",
        "",
      );
      if (manual == null) return;
      text = manual;
    }
    if (text.length > MAX_IMPORT_BYTES) {
      toast.error("Teks terlalu besar (maks 10MB).");
      return;
    }
    runImportFromText(text, "paste");
  };

  const importFromUrl = async () => {
    const raw = window.prompt(
      "Masukkan URL file JSON pengaturan tampilan (https://...):",
      "",
    );
    if (raw == null) return;
    const url = raw.trim();
    if (url === "") return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      toast.error("URL tidak valid.");
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      toast.error("URL harus memakai http(s)://.");
      return;
    }
    try {
      const res = await fetch(parsed.toString(), {
        method: "GET",
        redirect: "follow",
        credentials: "omit",
        cache: "no-store",
      });
      if (!res.ok) {
        toast.error(`Gagal mengambil URL (HTTP ${res.status}).`);
        return;
      }
      const lenHeader = res.headers.get("content-length");
      if (lenHeader && Number(lenHeader) > MAX_IMPORT_BYTES) {
        toast.error("File di URL terlalu besar (maks 10MB).");
        return;
      }
      const text = await res.text();
      if (text.length > MAX_IMPORT_BYTES) {
        toast.error("File di URL terlalu besar (maks 10MB).");
        return;
      }
      runImportFromText(text, "url");
    } catch {
      toast.error("Gagal mengambil URL (jaringan/CORS).");
    }
  };

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-32">
      <SettingsHeader title="Tampilan" subtitle="Preset, tema, aksen, font, latar & kerapatan" icon={Palette} />

      <div className="space-ms-4 px-ms-4 pt-2">
        {/* Info draft */}
        <div className="rounded-md border border-primary/30 bg-primary/5 px-ms-3 py-ms-2 text-ms-2xs leading-ms-snug text-muted-foreground">
          Perubahan di halaman ini adalah <span className="font-semibold text-foreground">pratinjau</span>.
          Tampilan halaman lain tidak berubah sampai Anda menekan{" "}
          <span className="font-semibold text-foreground">Simpan</span> di bagian bawah.
        </div>

        {/* Preset profesional */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <Sparkles className="h-4 w-4 text-primary" /> Preset profesional
            </CardTitle>
            <CardDescription className="text-ms-xs">
              Satu klik untuk mempratinjau tema, aksen, radius, font, dan kerapatan sekaligus.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-ms-2 sm:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="group flex flex-col gap-ms-1 rounded-lg border bg-card px-ms-3 py-ms-3 text-left transition-all duration-150 hover:border-primary/50 hover:bg-accent active:scale-[0.98]"
              >
                <span className="text-ms-lg leading-none">{p.icon}</span>
                <span className="text-ms-sm font-semibold">{p.label}</span>
                <span className="text-ms-2xs leading-ms-snug text-muted-foreground">{p.desc}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Tema */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <Moon className="h-4 w-4" /> Tema
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-ms-2">
              {([
                { v: "light" as Theme, label: "Terang", Icon: Sun },
                { v: "dark" as Theme, label: "Gelap", Icon: Moon },
                { v: "system" as Theme, label: "Sistem", Icon: Monitor },
              ]).map(({ v, label, Icon }) => (
                <button
                  key={v}
                  onClick={() => patch({ theme: v })}
                  className={`flex flex-col items-center gap-ms-1 rounded-md border px-ms-2 py-ms-3 text-ms-xs font-medium transition-all hover:bg-accent active:scale-[0.97] ${draft.theme === v ? "border-primary bg-accent" : ""}`}
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
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <Palette className="h-4 w-4" /> Warna aksen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-ms-2.5">
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
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <Type className="h-4 w-4" /> Font & ukuran
            </CardTitle>
          </CardHeader>
          <CardContent className="space-ms-4">
            <div>
              <p className="mb-2 text-ms-xs text-muted-foreground">Jenis font</p>
              <div className="grid grid-cols-2 gap-ms-2">
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
                    className={`rounded-md border px-ms-2 py-ms-2 text-left text-ms-xs font-medium hover:bg-accent active:scale-[0.97] transition-transform ${draft.font === o.v ? "border-primary bg-accent" : ""}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-ms-xs text-muted-foreground">Ukuran teks</p>
              <div className="grid grid-cols-4 gap-ms-2">
                {([
                  { v: "sm" as FontSize, label: "A−" },
                  { v: "md" as FontSize, label: "A" },
                  { v: "lg" as FontSize, label: "A+" },
                  { v: "xl" as FontSize, label: "A++" },
                ]).map((o) => (
                  <button
                    key={o.v}
                    onClick={() => patch({ size: o.v })}
                    className={`rounded-md border px-ms-2 py-ms-2 text-ms-sm font-semibold hover:bg-accent active:scale-[0.97] transition-transform ${draft.size === o.v ? "border-primary bg-accent" : ""}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-ms-xs text-muted-foreground">Skala font (in-app)</p>
                <span className="text-ms-xs font-semibold tabular-nums">{Math.round(draft.fontScale * 100)}%</span>
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
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <Layers className="h-4 w-4" /> Kerapatan & sudut
            </CardTitle>
          </CardHeader>
          <CardContent className="space-ms-4">
            <div className="flex items-start justify-between gap-ms-4">
              <div>
                <p className="text-ms-sm font-medium">Mode padat (compact)</p>
                <p className="text-ms-2xs leading-ms-snug text-muted-foreground">
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
                <p className="text-ms-xs text-muted-foreground">Kelengkungan sudut</p>
                <span className="text-ms-xs font-semibold tabular-nums">{draft.radius.toFixed(2)}rem</span>
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

            <div className="flex items-start justify-between gap-ms-4">
              <div>
                <p className="text-ms-sm font-medium">Kurangi animasi</p>
                <p className="text-ms-2xs leading-ms-snug text-muted-foreground">
                  Hilangkan animasi non-esensial untuk tampilan lebih tenang.
                </p>
              </div>
              <Switch
                checked={draft.reduceMotion}
                onCheckedChange={(v) => patch({ reduceMotion: v })}
              />
            </div>

            <div className="flex items-start justify-between gap-ms-4">
              <div>
                <p className="text-ms-sm font-medium">Tingkatkan kontras</p>
                <p className="text-ms-2xs leading-ms-snug text-muted-foreground">
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
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <ImageIcon className="h-4 w-4" /> Latar & transparansi
            </CardTitle>
            <CardDescription className="text-ms-xs">
              Pilih preset, unggah foto sendiri, dan atur kegelapan/blur overlay.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-ms-3">
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
                <p className="text-ms-xs font-semibold text-foreground">
                  {draft.bgImage ? `Overlay ${Math.round(draft.bgOverlay * 100)}%, blur ${draft.bgBlur}px` : "Belum ada foto latar"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-ms-2">
              {BG_PRESETS.map((p) => {
                const active = (p.url === "" && !draft.bgImage) || draft.bgImage === p.url;
                return (
                  <button
                    key={p.id}
                    onClick={() => patch({ bgImage: p.url })}
                    className={`relative h-14 overflow-hidden rounded-md border text-ms-2xs font-medium transition-transform hover:opacity-90 active:scale-95 ${active ? "border-primary ring-2 ring-primary" : "border-muted"}`}
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

            <div className="flex flex-wrap gap-ms-2">
              <label className="inline-flex flex-1 cursor-pointer items-center justify-center rounded-md border border-dashed px-ms-3 py-ms-2 text-ms-xs font-medium hover:bg-accent">
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
                  className="rounded-md border px-ms-3 py-ms-2 text-ms-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  Hapus latar
                </button>
              )}
            </div>

            {draft.bgImage && (
              <>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-ms-xs text-muted-foreground">Transparansi (overlay)</p>
                    <span className="text-ms-xs font-semibold tabular-nums">{Math.round(draft.bgOverlay * 100)}%</span>
                  </div>
                  <Slider
                    value={[draft.bgOverlay]}
                    min={0}
                    max={0.95}
                    step={0.05}
                    onValueChange={(v) => patch({ bgOverlay: v[0] ?? 0.7 })}
                    aria-label="Kegelapan overlay latar"
                  />
                  <p className="mt-1 text-ms-2xs text-muted-foreground">
                    0% = foto sepenuhnya tembus; 95% = hampir tak terlihat.
                  </p>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-ms-xs text-muted-foreground">Blur foto</p>
                    <span className="text-ms-xs font-semibold tabular-nums">{draft.bgBlur}px</span>
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
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <Download className="h-4 w-4" /> Ekspor & impor pengaturan
            </CardTitle>
            <CardDescription className="text-ms-xs">
              Simpan semua pengaturan di halaman ini (tema, aksen, font, ukuran, skala,
              kerapatan, radius, kontras, animasi, dan latar) menjadi satu file.
              Berguna untuk memindahkan tampilan yang sudah Anda atur ke HP/laptop
              lain, atau membagikannya ke rekan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-ms-3">
            <div className="grid grid-cols-1 gap-ms-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={exportSettings}
                className="flex items-start gap-ms-3 rounded-md border p-ms-3 text-left hover:bg-accent transition-transform active:scale-[0.98]"
              >
                <Download className="h-4 w-4 mt-0.5 text-primary" />
                <div>
                  <p className="text-ms-sm font-semibold">Ekspor ke file</p>
                  <p className="text-ms-2xs text-muted-foreground">
                    Unduh file <code className="rounded bg-muted px-1">.json</code> berisi
                    pengaturan tampilan Anda saat ini.
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex items-start gap-ms-3 rounded-md border p-ms-3 text-left hover:bg-accent transition-transform active:scale-[0.98]"
              >
                <Upload className="h-4 w-4 mt-0.5 text-primary" />
                <div>
                  <p className="text-ms-sm font-semibold">Impor dari file</p>
                  <p className="text-ms-2xs text-muted-foreground">
                    Pilih file hasil ekspor untuk memuatnya sebagai pratinjau.
                  </p>
                </div>
              </button>
              <button
                type="button"
                data-testid="import-from-paste"
                onClick={importFromPaste}
                className="flex items-start gap-ms-3 rounded-md border p-ms-3 text-left hover:bg-accent transition-transform active:scale-[0.98]"
              >
                <ClipboardPaste className="h-4 w-4 mt-0.5 text-primary" />
                <div>
                  <p className="text-ms-sm font-semibold">Impor dari clipboard</p>
                  <p className="text-ms-2xs text-muted-foreground">
                    Tempel JSON pengaturan dari clipboard. Fallback prompt manual
                    jika izin clipboard tidak tersedia.
                  </p>
                </div>
              </button>
              <button
                type="button"
                data-testid="import-from-url"
                onClick={importFromUrl}
                className="flex items-start gap-ms-3 rounded-md border p-ms-3 text-left hover:bg-accent transition-transform active:scale-[0.98]"
              >
                <Link2 className="h-4 w-4 mt-0.5 text-primary" />
                <div>
                  <p className="text-ms-sm font-semibold">Impor dari URL</p>
                  <p className="text-ms-2xs text-muted-foreground">
                    Ambil file JSON dari tautan <code className="rounded bg-muted px-1">https://…</code>{" "}
                    (dibatasi 10MB).
                  </p>
                </div>
              </button>
            </div>
            <p className="text-ms-2xs leading-ms-snug text-muted-foreground">
              Hasil impor hanya menimpa pratinjau di halaman ini — data akun, chat, dan
              gudang tidak terpengaruh. Tekan <span className="font-semibold text-foreground">Simpan</span>{" "}
              agar hasilnya diterapkan ke aplikasi.
            </p>
            <div className="grid grid-cols-1 gap-ms-2 rounded-md border bg-muted/30 p-ms-3 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 flex items-center gap-ms-1.5 text-ms-2xs font-semibold text-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Yang disimpan
                </p>
                <ul className="space-y-1 text-ms-2xs leading-ms-snug text-muted-foreground">
                  {[
                    "Tema (terang / gelap / ikut sistem)",
                    "Aksen warna & radius sudut",
                    "Font & ukuran teks",
                    "Skala teks (fontScale)",
                    "Mode kerapatan (compact)",
                    "Kontras tinggi & kurangi animasi",
                    "Foto latar, overlay, blur",
                    "Versi skema (untuk kompatibilitas)",
                  ].map((t) => (
                    <li key={t} className="flex gap-ms-1.5">
                      <CheckCircle2 className="mt-[2px] h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1.5 flex items-center gap-ms-1.5 text-ms-2xs font-semibold text-foreground">
                  <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                  Yang tidak disimpan
                </p>
                <ul className="space-y-1 text-ms-2xs leading-ms-snug text-muted-foreground">
                  {[
                    "Akun, email, PIN & sesi login",
                    "Isi chat, kontak & lampiran",
                    "Data gudang, stok, dan penjualan",
                    "Pelanggan, pemasok, hutang piutang",
                    "Riwayat unduhan APK",
                    "Bahasa & format mata uang/tanggal",
                    "Notifikasi & izin perangkat",
                    "Password / kunci akses",
                  ].map((t) => (
                    <li key={t} className="flex gap-ms-1.5">
                      <XCircle className="mt-[2px] h-3 w-3 shrink-0 text-red-600 dark:text-red-400" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
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
            <CardTitle className="text-ms-base">Pengaturan lain</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-ms-2 sm:grid-cols-2">
            <Link
              to="/pengaturan-bahasa"
              className="flex items-start gap-ms-3 rounded-md border p-ms-3 hover:bg-accent transition-transform active:scale-[0.98]"
            >
              <Languages className="h-4 w-4 mt-0.5 text-primary" />
              <div>
                <p className="text-ms-sm font-semibold">Bahasa & format</p>
                <p className="text-ms-2xs text-muted-foreground">Bahasa aplikasi, mata uang, format tanggal</p>
              </div>
            </Link>
            <Link
              to="/pengaturan-aksesibilitas"
              className="flex items-start gap-ms-3 rounded-md border p-ms-3 hover:bg-accent transition-transform active:scale-[0.98]"
            >
              <Accessibility className="h-4 w-4 mt-0.5 text-primary" />
              <div>
                <p className="text-ms-sm font-semibold">Aksesibilitas</p>
                <p className="text-ms-2xs text-muted-foreground">Skala teks lanjutan & animasi</p>
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
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-ms-2 px-ms-4 py-ms-3">
          <p className="text-ms-xs text-muted-foreground">
            Ada perubahan belum disimpan. Tampilan aplikasi utama belum berubah.
          </p>
          <div className="flex gap-ms-2">
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
