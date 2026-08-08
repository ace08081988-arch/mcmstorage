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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { RotateCcw, Sparkles, Sun, Moon, Monitor, Palette, Type, Image as ImageIcon, Layers, Languages, Accessibility, Download, Upload, Check, X, CheckCircle2, XCircle, ClipboardPaste, ClipboardCopy, Link2, CloudUpload, CloudDownload, CloudOff, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { ViewportAnchorSettings } from "@/components/settings/ViewportAnchorSettings";
import {
  applyAppearance,
  ACCENTS,
  BG_PRESETS,
  LS,
  DEFAULT_FX,
  readSurfaceFx,
  writeSurfaceFx,
  applySurfaceFx,
  type SurfaceFx,
} from "@/components/appearance-init";
import { useAppPrefs, setAppPrefs, getAppPrefs } from "@/lib/app-prefs";
import { useMidnightPreview, useMidnightScope, useThemeVariant } from "@/lib/midnight-preview";
import { encodePresetCode, decodeShareText } from "@/lib/appearance-share-code";
import {
  pullAppearanceFromCloud,
  pushAppearanceToCloudSafe,
  AppearanceValidationError,
  applyCloudPayload,
  fetchAppearanceFromCloud,
} from "@/lib/appearance-cloud";
import {
  listAppearanceBackups,
  deleteAppearanceBackup,
  validateAppearancePayload,
  MAX_APPEARANCE_BACKUPS,
  type AppearanceBackup,
} from "@/lib/appearance-backup";
import { COMPACT_MODE_EVENT } from "@/components/CompactModeToggle";
import { FullscreenModeToggle } from "@/components/FullscreenModeToggle";
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
import { scopedKey, peekUserIdSync } from "@/lib/user-scoped-storage";

const COMPACT_LS = "app-compact-mode";

import { readSyncTrace, writeSyncTrace, type SyncTrace } from "@/lib/appearance-sync-trace";

function fmtStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}
function relStamp(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
}

function readCompact(): boolean {
  return readCompactImpl();
}

/** Kartu kecil status sinkronisasi (waktu absolut + relatif). */
function SyncStat({
  icon,
  label,
  value,
  hint,
  busy,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string | null;
  busy: boolean;
  testId: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/40 px-ms-2 py-ms-2" data-testid={testId}>
      <p className="flex items-center gap-ms-1.5 text-ms-2xs font-medium text-muted-foreground">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
        {label}
      </p>
      <p className="mt-0.5 truncate text-ms-xs font-semibold">{value}</p>
      {hint && <p className="text-ms-2xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function readCompactImpl(): boolean {
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
      { title: "Tampilan · Pengaturan — Ace Storage" },
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
    fx?: Partial<SurfaceFx>;
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

const FX_PRESETS: Preset[] = [
  {
    id: "kaca",
    label: "Kaca (Glass)",
    desc: "Permukaan tembus pandang + blur lembut",
    icon: "🧊",
    values: {
      theme: "dark", accent: "cyan", radius: 1, font: "display", size: "md",
      compact: false, fontScale: 1,
      fx: { glass: true, surfaceOpacity: 0.62, surfaceBlur: 18, sidebarOpacity: 0.55, shadow: 1.6, saturation: 1.1, accentGradient: true },
    },
  },
  {
    id: "neon",
    label: "Neon Malam",
    desc: "Gelap pekat, aksen indigo, bayangan dalam",
    icon: "🌌",
    values: {
      theme: "dark", accent: "indigo", radius: 0.75, font: "sans", size: "md",
      compact: true, fontScale: 1,
      fx: { glass: true, surfaceOpacity: 0.8, surfaceBlur: 10, sidebarOpacity: 0.7, shadow: 2.4, saturation: 1.25, accentGradient: true },
    },
  },
  {
    id: "kertas",
    label: "Kertas",
    desc: "Terang, datar, tanpa bayangan",
    icon: "📄",
    values: {
      theme: "light", accent: "slate", radius: 0.25, font: "serif", size: "md",
      compact: false, fontScale: 1,
      fx: { glass: false, surfaceOpacity: 1, surfaceBlur: 0, sidebarOpacity: 1, shadow: 0, saturation: 0.92, accentGradient: false },
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
  fx: SurfaceFx;
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
  applySurfaceFx(v.fx);
}

function readSnapshot(prefsSeed: { fontScale: number; highContrast: boolean; reduceMotion: boolean }): Draft {
  if (typeof window === "undefined") {
    return {
      theme: "dark", font: "sans", size: "md", accent: "emerald",
      radius: 0.625, bgImage: "", bgOverlay: 0.7, bgBlur: 0,
      compact: true, fontScale: 1, highContrast: false, reduceMotion: false,
      fx: { ...DEFAULT_FX },
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
    fx: readSurfaceFx(),
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
  fx: { ...DEFAULT_FX },
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
    a.reduceMotion === b.reduceMotion &&
    JSON.stringify(a.fx) === JSON.stringify(b.fx)
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
  const [resetOpen, setResetOpen] = useState(false);
  const [cloudBusy, setCloudBusy] = useState<"push" | "pull" | null>(null);
  const [cloudAt, setCloudAt] = useState<string | null>(null);
  const [syncTrace, setSyncTrace] = useState<SyncTrace>({
    pushAt: null,
    pullAt: null,
    error: null,
  });
  /** Catat hasil sinkronisasi terakhir (memory + localStorage per user). */
  const markSync = (patch: Partial<SyncTrace>) => {
    setSyncTrace((prev) => {
      const next = { ...prev, ...patch };
      writeSyncTrace(next);
      return next;
    });
  };
  const [backups, setBackups] = useState<AppearanceBackup[]>([]);
  const [midnightOn, setMidnightOn] = useMidnightPreview();
  const [midnightScope, setMidnightScope] = useMidnightScope();
  const [themeVariant, setThemeVariant] = useThemeVariant();
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
  const patchFx = (p: Partial<SurfaceFx>) =>
    setDraft((d) => ({ ...d, fx: { ...d.fx, ...p } }));

  const applyPreset = (p: Preset) => {
    patch({
      theme: p.values.theme,
      accent: p.values.accent,
      radius: p.values.radius,
      font: p.values.font,
      size: p.values.size,
      compact: p.values.compact,
      fontScale: p.values.fontScale,
      ...(p.values.fx ? { fx: { ...DEFAULT_FX, ...p.values.fx } } : {}),
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

  /** Reset semua pengaturan tampilan ke bawaan sekaligus menyimpannya. */
  const resetAllAndSave = () => {
    setDraft(DEFAULT_DRAFT);
    persist(DEFAULT_DRAFT);
    setResetOpen(false);
    toast.success("Semua pengaturan tampilan dikembalikan ke bawaan.");
  };

  const persist = (d: Draft) => {
    // Persist appearance-* LS
    localStorage.setItem(LS.theme, d.theme);
    localStorage.setItem(LS.font, d.font);
    localStorage.setItem(LS.size, d.size);
    localStorage.setItem(LS.accent, d.accent);
    localStorage.setItem(LS.radius, String(d.radius));
    if (d.bgImage) localStorage.setItem(LS.bgImage, d.bgImage);
    else localStorage.removeItem(LS.bgImage);
    localStorage.setItem(LS.bgOverlay, String(d.bgOverlay));
    localStorage.setItem(LS.bgBlur, String(d.bgBlur));
    writeSurfaceFx(d.fx);
    applyAppearance();

    // Compact + app-prefs
    writeCompact(d.compact);
    setAppPrefs({
      fontScale: d.fontScale,
      highContrast: d.highContrast,
      reduceMotion: d.reduceMotion,
    });

    savedRef.current = true;
    setSnapshot(d);
    // Izinkan draft berikutnya kembali di-revert saat unmount.
    setTimeout(() => { savedRef.current = false; }, 0);

    // Sinkronkan ke akun (validasi + cadangkan versi lama dulu).
    void pushAppearanceToCloudSafe(buildPayloadFrom(d))
      .then((res) => {
        setCloudAt(res.updatedAt);
        setBackups(listAppearanceBackups());
        markSync({ pushAt: new Date().toISOString(), error: null });
      })
      .catch((e) => {
        if (e instanceof AppearanceValidationError) {
          markSync({ error: `Ditolak validasi: ${e.errors.join(" ")}` });
          toast.error("Tersimpan di perangkat ini, tapi ditolak saat sinkron.", {
            description: e.errors.join(" "),
          });
          return;
        }
        markSync({ error: "Gagal menyimpan ke akun (koneksi / server)." });
        toast.warning("Tersimpan di perangkat ini, tapi gagal sinkron ke akun.", {
          description: "Coba lagi lewat tombol “Simpan ke akun”.",
        });
      });
  };

  const commitSave = () => {
    persist(draft);
    toast.success("Pengaturan tampilan disimpan");
  };

  const commitCancel = () => {
    setDraft(snapshot);
    toast.info("Perubahan dibatalkan");
  };

  /** Payload ekspor tunggal — dipakai file .json maupun kode preset. */
  const buildPayloadFrom = (d: Draft) => ({
        __type: EXPORT_SCHEMA_TYPE,
        schemaVersion: EXPORT_SCHEMA_VERSION,
        // `version` dipertahankan untuk kompatibilitas importer versi lama
        // (rilis <=Q3-2026) yang membaca field `version` alih-alih `schemaVersion`.
        version: EXPORT_SCHEMA_VERSION,
        app: APPEARANCE_APP_ID,
        exportedAt: new Date().toISOString(),
        appearance: {
          theme: d.theme,
          font: d.font,
          size: d.size,
          accent: d.accent,
          radius: String(d.radius),
          bgImage: d.bgImage,
          bgOverlay: String(d.bgOverlay),
          bgBlur: String(d.bgBlur),
        },
        fx: d.fx,
        compact: d.compact,
        appPrefs: {
          fontScale: d.fontScale,
          highContrast: d.highContrast,
          reduceMotion: d.reduceMotion,
        },
  });

  const buildExportPayload = () => buildPayloadFrom(draft);

  // Tampilkan kapan terakhir tersinkron ke akun.
  useEffect(() => {
    let alive = true;
    void fetchAppearanceFromCloud()
      .then((c) => { if (alive && c) setCloudAt(c.updatedAt); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Pulihkan jejak sinkronisasi perangkat ini (terakhir disimpan / diambil).
  useEffect(() => {
    setSyncTrace(readSyncTrace());
  }, []);

  /** Simpan pengaturan saat ini ke akun (manual). */
  const saveToCloud = async () => {
    setCloudBusy("push");
    try {
      const res = await pushAppearanceToCloudSafe(buildExportPayload());
      setCloudAt(res.updatedAt);
      setBackups(listAppearanceBackups());
      markSync({ pushAt: new Date().toISOString(), error: null });
      toast.success("Pengaturan tampilan tersimpan di akun Anda.", {
        description: res.backup
          ? "Versi akun sebelumnya dicadangkan dan bisa dipulihkan."
          : undefined,
      });
      if (res.warnings.length > 0) {
        toast.warning("Beberapa nilai dilewati saat menyimpan.", {
          description: res.warnings.join(" "),
        });
      }
    } catch (e) {
      if (e instanceof AppearanceValidationError) {
        markSync({ error: `Ditolak validasi: ${e.errors.join(" ")}` });
        toast.error("Pengaturan belum valid — penyimpanan dibatalkan.", {
          description: e.errors.join(" "),
          duration: 8000,
        });
      } else {
        markSync({ error: "Gagal menyimpan ke akun (koneksi / server)." });
        toast.error("Gagal menyimpan ke akun. Periksa koneksi lalu coba lagi.");
      }
    } finally {
      setCloudBusy(null);
    }
  };

  /** Muat daftar cadangan lokal saat halaman dibuka. */
  useEffect(() => {
    setBackups(listAppearanceBackups());
  }, []);

  /** Pulihkan satu cadangan: terapkan di perangkat ini lalu dorong ke akun. */
  const restoreBackup = async (b: AppearanceBackup) => {
    setCloudBusy("push");
    try {
      applyCloudPayload(b.payload);
      const p = getAppPrefs();
      const fresh = readSnapshot({
        fontScale: p.fontScale,
        highContrast: p.highContrast,
        reduceMotion: p.reduceMotion,
      });
      savedRef.current = true;
      setSnapshot(fresh);
      setDraft(fresh);
      setTimeout(() => { savedRef.current = false; }, 0);

      const res = await pushAppearanceToCloudSafe(b.payload);
      setCloudAt(res.updatedAt);
      setBackups(listAppearanceBackups());
      markSync({ pushAt: new Date().toISOString(), error: null });
      toast.success("Cadangan dipulihkan dan disimpan kembali ke akun.");
    } catch {
      markSync({ error: "Cadangan gagal disinkronkan ke akun." });
      toast.warning("Cadangan diterapkan di perangkat ini, tapi gagal sinkron ke akun.");
      setBackups(listAppearanceBackups());
    } finally {
      setCloudBusy(null);
    }
  };

  /** Ambil pengaturan tampilan dari akun dan terapkan di perangkat ini. */
  const loadFromCloud = async () => {
    setCloudBusy("pull");
    try {
      const cloud = await pullAppearanceFromCloud();
      if (!cloud) {
        toast.info("Belum ada pengaturan tampilan tersimpan di akun ini.");
        return;
      }
      const p = getAppPrefs();
      const fresh = readSnapshot({
        fontScale: p.fontScale,
        highContrast: p.highContrast,
        reduceMotion: p.reduceMotion,
      });
      savedRef.current = true;
      setSnapshot(fresh);
      setDraft(fresh);
      setCloudAt(cloud.updatedAt);
      setTimeout(() => { savedRef.current = false; }, 0);
      markSync({ pullAt: new Date().toISOString(), error: null });
      toast.success("Pengaturan tampilan dari akun diterapkan.");
    } catch {
      markSync({ error: "Gagal mengambil pengaturan dari akun." });
      toast.error("Gagal mengambil pengaturan dari akun.");
    } finally {
      setCloudBusy(null);
    }
  };

  const exportSettings = () => {
    try {
      const payload = buildExportPayload();
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
    const json = decodeShareText(text || "{}");
    if (json == null) {
      logAppearanceMigration(source, { ok: false, reason: "invalid" });
      toast.error("Kode preset rusak atau tidak lengkap.");
      return;
    }
    try {
      data = JSON.parse(json || "{}");
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
            `Payload tidak dikenali sebagai pengaturan tampilan Ace (${source}).`,
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
      const { fx, ...rest } = result.patch;
      return { ...d, ...rest, ...(fx ? { fx: { ...d.fx, ...fx } } : {}) };
    });
  };

  /** Salin kode preset ringkas supaya bisa dikirim lewat chat ke HP lain. */
  const copyPresetCode = async () => {
    const { code, droppedBackground } = encodePresetCode(buildExportPayload());
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      window.prompt("Salin kode preset ini:", code);
    }
    toast.success("Kode preset disalin.", {
      description: droppedBackground
        ? "Foto latar tidak ikut (terlalu besar) — pakai ekspor file untuk menyertakannya."
        : "Tempel di perangkat lain lewat “Impor dari clipboard/kode”.",
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
        "Tempel JSON pengaturan tampilan Ace di sini:",
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
              <Moon className="h-4 w-4 text-primary" /> Tema gelap premium
            </CardTitle>
            <CardDescription className="text-ms-xs">
              Pilih <span className="font-semibold text-foreground">Noir &amp; Gold</span> (hitam
              pekat, aksen emas) atau{" "}
              <span className="font-semibold text-foreground">Midnight Indigo</span>. Cakupan
              bisa dibatasi ke Beranda &amp; Gudang atau seluruh aplikasi.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-ms-3">
            <div className="min-w-0">
              <p className="text-ms-sm font-semibold">Aktifkan pratinjau</p>
              <p className="text-ms-2xs leading-ms-snug text-muted-foreground">
                Berlaku langsung tanpa perlu menekan Simpan, dan bisa dimatikan kapan saja.
              </p>
            </div>
            <Switch
              checked={midnightOn}
              onCheckedChange={(v) => {
                setMidnightOn(v);
                toast.success(
                  v
                    ? "Midnight Indigo aktif di Beranda & Gudang"
                    : "Midnight Indigo dimatikan",
                );
              }}
              aria-label="Aktifkan pratinjau Midnight Indigo"
            />
          </CardContent>
          {midnightOn ? (
            <CardContent className="space-ms-3 border-t pt-ms-3">
              <div className="mb-ms-3">
                <p className="text-ms-xs text-muted-foreground">Palet</p>
                <div className="mt-2 grid grid-cols-2 gap-ms-2">
                  {(
                    [
                      {
                        v: "noir" as const,
                        label: "Noir & Gold",
                        hint: "Hitam pekat, aksen emas",
                        swatch: ["#0B0B0D", "#15151A", "#C9A227", "#EDE7D6"],
                      },
                      {
                        v: "indigo" as const,
                        label: "Midnight Indigo",
                        hint: "Biru gelap editorial",
                        swatch: ["#0A0F1F", "#151C33", "#6366F1", "#E6E9F5"],
                      },
                    ]
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => {
                        setThemeVariant(o.v);
                        toast.success(`Palet ${o.label} diterapkan`);
                      }}
                      aria-pressed={themeVariant === o.v}
                      className={`rounded-md border px-ms-2 py-ms-2 text-left transition-transform hover:bg-accent active:scale-[0.97] ${themeVariant === o.v ? "border-primary bg-accent" : ""}`}
                    >
                      <span className="mb-1.5 flex gap-1">
                        {o.swatch.map((c) => (
                          <span
                            key={c}
                            aria-hidden
                            className="h-3 w-3 rounded-full border border-border/60"
                            style={{ background: c }}
                          />
                        ))}
                      </span>
                      <span className="block text-ms-xs font-semibold">{o.label}</span>
                      <span className="block text-ms-2xs leading-ms-snug text-muted-foreground">
                        {o.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-ms-xs text-muted-foreground">Cakupan tema</p>
                <div className="mt-2 grid grid-cols-2 gap-ms-2">
                  {(
                    [
                      { v: "pages" as const, label: "Beranda & Gudang", hint: "Halaman lain pakai preset Anda" },
                      { v: "all" as const, label: "Semua halaman", hint: "Konsisten di seluruh aplikasi" },
                    ]
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => {
                        setMidnightScope(o.v);
                        toast.success(
                          o.v === "all"
                            ? "Tema aktif di semua halaman"
                            : "Tema dibatasi ke Beranda & Gudang",
                        );
                      }}
                      className={`rounded-md border px-ms-2 py-ms-2 text-left transition-transform hover:bg-accent active:scale-[0.97] ${midnightScope === o.v ? "border-primary bg-accent" : ""}`}
                    >
                      <span className="block text-ms-xs font-semibold">{o.label}</span>
                      <span className="block text-ms-2xs leading-ms-snug text-muted-foreground">
                        {o.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          ) : null}
          <CardContent className="border-t pt-ms-3">
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                patch({ font: "editorial", theme: "dark" });
                setMidnightOn(true);
                setMidnightScope("all");
                setThemeVariant("noir");
                toast.success("Preset Editorial × Noir & Gold diterapkan ke semua halaman");
              }}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Terapkan Editorial × Noir &amp; Gold (semua halaman)
            </Button>
            <p className="mt-2 text-ms-2xs leading-ms-snug text-muted-foreground">
              Judul Instrument Serif + teks Work Sans, dipadukan palet hitam-emas di
              seluruh halaman. Tekan Simpan untuk menyimpan pilihan font.
            </p>
          </CardContent>
        </Card>

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
            {FX_PRESETS.map((p) => (
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
                  { v: "editorial" as FontFamily, label: "Editorial (Instrument Serif)", family: "'Instrument Serif', Georgia, serif" },
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

        {/* Mode layar penuh (PWA iOS/Android) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <Layers className="h-4 w-4" /> Mode layar penuh
            </CardTitle>
            <CardDescription className="text-ms-xs">
              Atur agar aplikasi tampil benar-benar penuh saat dipasang di HP —
              tanpa header ganda atau ruang kosong di atas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FullscreenModeToggle />
          </CardContent>
        </Card>

        {/* Latar & transparansi */}
        {/* Transparansi & efek kaca */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              <Sparkles className="h-4 w-4 text-primary" /> Transparansi & efek kaca
            </CardTitle>
            <CardDescription className="text-ms-xs">
              Atur seberapa tembus pandang kartu, sidebar, dan panel — plus blur,
              bayangan, saturasi warna, dan gradien aksen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-ms-4">
            <div className="flex items-start justify-between gap-ms-4">
              <div>
                <p className="text-ms-sm font-medium">Efek kaca (glass)</p>
                <p className="text-ms-2xs leading-ms-snug text-muted-foreground">
                  Kartu, dialog, dan sidebar jadi tembus pandang dengan blur di belakangnya.
                </p>
              </div>
              <Switch
                checked={draft.fx.glass}
                onCheckedChange={(v) => patchFx({ glass: v })}
              />
            </div>

            <div className={draft.fx.glass ? "space-ms-4" : "space-ms-4 pointer-events-none opacity-50"}>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-ms-xs text-muted-foreground">Transparansi kartu & dialog</p>
                  <span className="text-ms-xs font-semibold tabular-nums">
                    {Math.round(draft.fx.surfaceOpacity * 100)}% padat
                  </span>
                </div>
                <Slider
                  value={[draft.fx.surfaceOpacity]}
                  min={0.3}
                  max={1}
                  step={0.02}
                  onValueChange={(v) => patchFx({ surfaceOpacity: v[0] ?? 1 })}
                  aria-label="Transparansi kartu"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-ms-xs text-muted-foreground">Transparansi sidebar & panel</p>
                  <span className="text-ms-xs font-semibold tabular-nums">
                    {Math.round(draft.fx.sidebarOpacity * 100)}% padat
                  </span>
                </div>
                <Slider
                  value={[draft.fx.sidebarOpacity]}
                  min={0.3}
                  max={1}
                  step={0.02}
                  onValueChange={(v) => patchFx({ sidebarOpacity: v[0] ?? 1 })}
                  aria-label="Transparansi sidebar"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-ms-xs text-muted-foreground">Blur di belakang permukaan</p>
                  <span className="text-ms-xs font-semibold tabular-nums">{draft.fx.surfaceBlur}px</span>
                </div>
                <Slider
                  value={[draft.fx.surfaceBlur]}
                  min={0}
                  max={30}
                  step={1}
                  onValueChange={(v) => patchFx({ surfaceBlur: v[0] ?? 12 })}
                  aria-label="Blur permukaan"
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-ms-xs text-muted-foreground">Kedalaman bayangan</p>
                <span className="text-ms-xs font-semibold tabular-nums">{draft.fx.shadow.toFixed(1)}×</span>
              </div>
              <Slider
                value={[draft.fx.shadow]}
                min={0}
                max={3}
                step={0.1}
                onValueChange={(v) => patchFx({ shadow: v[0] ?? 1 })}
                aria-label="Kedalaman bayangan"
              />
              <p className="mt-1 text-ms-2xs text-muted-foreground">0 = datar (flat), 3 = melayang dramatis.</p>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-ms-xs text-muted-foreground">Saturasi warna antarmuka</p>
                <span className="text-ms-xs font-semibold tabular-nums">{Math.round(draft.fx.saturation * 100)}%</span>
              </div>
              <Slider
                value={[draft.fx.saturation]}
                min={0.6}
                max={1.4}
                step={0.02}
                onValueChange={(v) => patchFx({ saturation: v[0] ?? 1 })}
                aria-label="Saturasi warna"
              />
            </div>

            <div className="flex items-start justify-between gap-ms-4">
              <div>
                <p className="text-ms-sm font-medium">Gradien aksen</p>
                <p className="text-ms-2xs leading-ms-snug text-muted-foreground">
                  Tombol utama memakai gradasi warna aksen agar terlihat lebih mewah.
                </p>
              </div>
              <Switch
                checked={draft.fx.accentGradient}
                onCheckedChange={(v) => patchFx({ accentGradient: v })}
              />
            </div>

            {/* Pratinjau mini */}
            <div className="relative overflow-hidden rounded-lg border p-ms-3">
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  backgroundImage: draft.bgImage
                    ? `url("${draft.bgImage}")`
                    : "linear-gradient(135deg, var(--primary), var(--muted))",
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  opacity: 0.9,
                }}
              />
              <div
                className="relative rounded-md border p-ms-3"
                style={{
                  backgroundColor: `color-mix(in oklab, var(--card) ${Math.round((draft.fx.glass ? draft.fx.surfaceOpacity : 1) * 100)}%, transparent)`,
                  backdropFilter: draft.fx.glass ? `blur(${draft.fx.surfaceBlur}px) saturate(140%)` : undefined,
                }}
              >
                <p className="text-ms-sm font-semibold">Pratinjau kartu</p>
                <p className="text-ms-2xs text-muted-foreground">
                  Begini tampilan permukaan di atas latar.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Latar & foto */}
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
              <Sparkles className="h-4 w-4" /> Sinkron ke akun
            </CardTitle>
            <CardDescription className="text-ms-xs">
              Pengaturan tampilan otomatis tersimpan ke akun Anda setiap kali menekan
              Simpan, lalu ikut terpasang saat Anda masuk di perangkat lain.
              {cloudAt ? (
                <>
                  {" "}Terakhir tersinkron:{" "}
                  <span className="font-semibold text-foreground">
                    {new Date(cloudAt).toLocaleString("id-ID")}
                  </span>
                  .
                </>
              ) : (
                " Belum ada data tersimpan di akun."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-ms-2 sm:grid-cols-2">
            <div className="sm:col-span-2" data-testid="appearance-sync-status">
              <div className="grid grid-cols-1 gap-ms-2 sm:grid-cols-3">
                <SyncStat
                  icon={<CloudUpload className="h-3.5 w-3.5" />}
                  label="Terakhir disimpan"
                  value={fmtStamp(syncTrace.pushAt)}
                  hint={relStamp(syncTrace.pushAt)}
                  busy={cloudBusy === "push"}
                  testId="appearance-sync-push-at"
                />
                <SyncStat
                  icon={<CloudDownload className="h-3.5 w-3.5" />}
                  label="Terakhir diambil"
                  value={fmtStamp(syncTrace.pullAt)}
                  hint={relStamp(syncTrace.pullAt)}
                  busy={cloudBusy === "pull"}
                  testId="appearance-sync-pull-at"
                />
                <SyncStat
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  label="Versi di akun"
                  value={fmtStamp(cloudAt)}
                  hint={relStamp(cloudAt)}
                  busy={false}
                  testId="appearance-sync-cloud-at"
                />
              </div>
              {syncTrace.error && (
                <p
                  data-testid="appearance-sync-error"
                  className="mt-ms-2 flex items-start gap-ms-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-ms-2 py-ms-2 text-ms-2xs text-destructive"
                >
                  <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{syncTrace.error}</span>
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              data-testid="appearance-cloud-push"
              disabled={cloudBusy !== null}
              onClick={saveToCloud}
              className="justify-start gap-ms-2"
            >
              <Upload className="h-4 w-4" />
              {cloudBusy === "push" ? "Menyimpan…" : "Simpan ke akun"}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="appearance-cloud-pull"
              disabled={cloudBusy !== null}
              onClick={loadFromCloud}
              className="justify-start gap-ms-2"
            >
              <Download className="h-4 w-4" />
              {cloudBusy === "pull" ? "Mengambil…" : "Ambil dari akun"}
            </Button>
          </CardContent>
          <CardContent className="space-ms-3 pt-0">
            {(() => {
              const check = validateAppearancePayload(buildExportPayload());
              if (check.ok) return null;
              return (
                <div
                  data-testid="appearance-validation-errors"
                  className="rounded-md border border-destructive/40 bg-destructive/10 p-ms-3 text-ms-2xs text-destructive"
                >
                  <p className="font-semibold">Belum bisa disimpan ke akun:</p>
                  <ul className="mt-1 list-disc pl-4">
                    {check.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            <div className="rounded-md border p-ms-3">
              <p className="text-ms-sm font-semibold">Cadangan otomatis</p>
              <p className="text-ms-2xs text-muted-foreground">
                Setiap kali menimpa preset di akun, versi sebelumnya dicadangkan di
                perangkat ini (maks. {MAX_APPEARANCE_BACKUPS} versi terakhir).
              </p>
              {backups.length === 0 ? (
                <p className="mt-ms-2 text-ms-2xs text-muted-foreground">
                  Belum ada cadangan.
                </p>
              ) : (
                <ul className="mt-ms-2 space-y-1" data-testid="appearance-backup-list">
                  {backups.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center gap-ms-2 rounded-md border bg-card px-ms-2 py-ms-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-ms-xs font-medium">
                          {new Date(b.cloudUpdatedAt ?? b.createdAt).toLocaleString("id-ID")}
                        </p>
                        <p className="truncate text-ms-2xs text-muted-foreground">
                          Dicadangkan {new Date(b.createdAt).toLocaleString("id-ID")}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={cloudBusy !== null}
                        onClick={() => void restoreBackup(b)}
                      >
                        Pulihkan
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={cloudBusy !== null}
                        onClick={() => {
                          deleteAppearanceBackup(b.id);
                          setBackups(listAppearanceBackups());
                        }}
                      >
                        Hapus
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

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
                  <p className="text-ms-sm font-semibold">Impor dari clipboard / kode</p>
                  <p className="text-ms-2xs text-muted-foreground">
                    Tempel kode preset (ACETAMPILAN1:…) atau JSON pengaturan.
                    Fallback prompt manual jika izin clipboard ditolak.
                  </p>
                </div>
              </button>
              <button
                type="button"
                data-testid="copy-preset-code"
                onClick={copyPresetCode}
                className="flex items-start gap-ms-3 rounded-md border p-ms-3 text-left hover:bg-accent transition-transform active:scale-[0.98]"
              >
                <ClipboardCopy className="h-4 w-4 mt-0.5 text-primary" />
                <div>
                  <p className="text-ms-sm font-semibold">Salin kode preset</p>
                  <p className="text-ms-2xs text-muted-foreground">
                    Kode teks pendek untuk dikirim lewat WhatsApp/chat ke perangkat
                    lain, lalu ditempel di sana.
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
                  <CheckCircle2 className="h-3.5 w-3.5 text-success dark:text-success" />
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
                      <CheckCircle2 className="mt-[2px] h-3 w-3 shrink-0 text-success dark:text-success" />
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

        <ViewportAnchorSettings />

        <div className="flex flex-wrap justify-end gap-ms-2">
          <Button variant="outline" size="sm" onClick={resetAll}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Pratinjau bawaan
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setResetOpen(true)}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset semua ke bawaan
          </Button>
        </div>
      </div>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset semua pengaturan tampilan?</AlertDialogTitle>
            <AlertDialogDescription>
              Tema, warna aksen, font, sudut, foto latar, efek kaca/transparansi,
              mode ringkas, dan aksesibilitas akan kembali ke bawaan dan langsung
              disimpan. Data bisnis tidak terpengaruh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={resetAllAndSave}>
              Ya, reset sekarang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sticky action bar — muncul saat ada perubahan belum disimpan */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur transition-transform app-safe-bottom ${dirty ? "translate-y-0" : "translate-y-full"}`}
        inert={!dirty}
        aria-hidden={!dirty}
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
