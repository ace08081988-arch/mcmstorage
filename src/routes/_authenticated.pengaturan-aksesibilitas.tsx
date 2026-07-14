import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RotateCcw, Check, X, AlertTriangle, Accessibility } from "lucide-react";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { DEFAULT_APP_PREFS, useAppPrefs, setAppPrefs } from "@/lib/app-prefs";

export const Route = createFileRoute("/_authenticated/pengaturan-aksesibilitas")({
  head: () => ({ meta: [{ title: "Aksesibilitas · MCM Storage" }] }),
  component: PengaturanAksesibilitasPage,
});

function PengaturanAksesibilitasPage() {
  const { prefs } = useAppPrefs();
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);

  // Snapshot nilai tersimpan saat halaman dibuka — dipakai untuk revert.
  const [snapshot, setSnapshot] = useState(() => ({
    fontScale: prefs.fontScale,
    highContrast: prefs.highContrast,
    reduceMotion: prefs.reduceMotion,
  }));
  // Draft — hanya pratinjau, belum ditulis ke penyimpanan.
  const [draft, setDraft] = useState(snapshot);
  const savedRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Dialog konfirmasi saat mencoba keluar dengan perubahan belum disimpan.
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveResolveRef = useRef<((proceed: boolean) => void) | null>(null);

  const dirty = useMemo(
    () =>
      draft.fontScale !== snapshot.fontScale ||
      draft.highContrast !== snapshot.highContrast ||
      draft.reduceMotion !== snapshot.reduceMotion,
    [draft, snapshot],
  );

  useBlocker({
    shouldBlockFn: () => {
      if (!dirty) return false;
      return new Promise<boolean>((resolve) => {
        leaveResolveRef.current = resolve;
        setLeaveOpen(true);
      });
    },
    enableBeforeUnload: true,
  });

  const handleLeaveConfirm = () => {
    leaveResolveRef.current?.(true);
    leaveResolveRef.current = null;
    setLeaveOpen(false);
  };
  const handleLeaveCancel = () => {
    leaveResolveRef.current?.(false);
    leaveResolveRef.current = null;
    setLeaveOpen(false);
  };

  // Terapkan draft ke <html> tanpa persist.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--app-font-scale", String(draft.fontScale));
    root.dataset.highContrast = draft.highContrast ? "on" : "off";
    root.dataset.reduceMotion = draft.reduceMotion ? "on" : "off";
  }, [draft]);

  // Kalau keluar tanpa Simpan, kembalikan tampilan ke snapshot terakhir.
  useEffect(() => {
    return () => {
      if (!savedRef.current) {
        const s = snapshotRef.current;
        const root = document.documentElement;
        root.style.setProperty("--app-font-scale", String(s.fontScale));
        root.dataset.highContrast = s.highContrast ? "on" : "off";
        root.dataset.reduceMotion = s.reduceMotion ? "on" : "off";
      }
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setSystemReducedMotion(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);


  const commitSave = () => {
    if (!dirty) return;
    setAppPrefs({
      fontScale: draft.fontScale,
      highContrast: draft.highContrast,
      reduceMotion: draft.reduceMotion,
    });
    savedRef.current = true;
    setSnapshot(draft);
    setTimeout(() => { savedRef.current = false; }, 0);
    toast.success("Pengaturan disimpan");
  };
  const commitCancel = () => {
    if (!dirty) return;
    setDraft(snapshot);
    toast.info("Perubahan dibatalkan");
  };
  const resetDraft = () => {
    setDraft({
      fontScale: DEFAULT_APP_PREFS.fontScale,
      highContrast: DEFAULT_APP_PREFS.highContrast,
      reduceMotion: DEFAULT_APP_PREFS.reduceMotion,
    });
    toast.info("Draft direset ke bawaan — tekan Simpan untuk menerapkan.");
  };

  // Shortcut keyboard: Ctrl/Cmd+S menyimpan draft, Esc membatalkan draft.
  const commitSaveRef = useRef(commitSave);
  const commitCancelRef = useRef(commitCancel);
  commitSaveRef.current = commitSave;
  commitCancelRef.current = commitCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (leaveOpen) return;
      const isSave = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "s" || e.key === "S");
      if (isSave) {
        e.preventDefault();
        commitSaveRef.current();
        return;
      }
      if (e.key === "Escape") {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        if (t?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (!dirty) return;
        e.preventDefault();
        commitCancelRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, leaveOpen]);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-32">
      <SettingsHeader
        title="Aksesibilitas"
        subtitle="Skala teks, kontras, dan animasi"
        icon={Accessibility}
      />
      <div className="space-ms-4 px-ms-4 pt-2">
        {/* Badge status "Belum disimpan" — hanya tampil kalau draft ≠ snapshot */}
        <div
          className="flex items-center gap-ms-2 text-ms-xs"
          role="status"
          aria-live="polite"
        >
          {dirty ? (
            <span className="inline-flex items-center gap-ms-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-ms-2.5 py-1 font-medium text-amber-700 dark:text-amber-300">
              <span
                className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"
                aria-hidden="true"
              />
              Belum disimpan
            </span>
          ) : (
            <span className="inline-flex items-center gap-ms-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-ms-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-300">
              <span
                className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              Tersimpan
            </span>
          )}
        </div>

        <div className="rounded-md border border-primary/30 bg-primary/5 px-ms-3 py-ms-2 text-ms-2xs leading-snug text-muted-foreground">
          Perubahan di halaman ini adalah <span className="font-semibold text-foreground">pratinjau</span>.
          Tampilan tersimpan tidak berubah sampai Anda menekan{" "}
          <span className="font-semibold text-foreground">Simpan</span> di bagian bawah.
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-ms-2 text-ms-base">
              Skala teks
              {draft.fontScale !== snapshot.fontScale && (
                <UnsavedDot title={`Tersimpan: ${Math.round(snapshot.fontScale * 100)}%`} />
              )}
            </CardTitle>
            <CardDescription className="text-ms-xs">
              Perbesar teks di seluruh aplikasi. Diterapkan lewat variabel CSS <code>--app-font-scale</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-ms-3">
            <div className="flex items-baseline justify-between">
              <span className="text-ms-sm">Kecil</span>
              <span className="text-ms-sm tabular-nums font-semibold">
                {Math.round(draft.fontScale * 100)}%
              </span>
              <span className="text-ms-sm">Besar</span>
            </div>
            <Slider
              value={[draft.fontScale]}
              min={0.9}
              max={1.4}
              step={0.05}
              onValueChange={(v) => setDraft((d) => ({ ...d, fontScale: v[0] ?? 1 }))}
              aria-label="Skala teks"
            />
            <div
              className="rounded-md border bg-muted/30 p-ms-3 text-muted-foreground"
              style={{ fontSize: `${draft.fontScale}rem` }}
            >
              Pratinjau — teks pesan chat, tombol, dan header ikut menyesuaikan.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-ms-base">Kontras & animasi</CardTitle>
          </CardHeader>
          <CardContent className="space-ms-4">
            <ToggleRow
              label="Tingkatkan kontras"
              unsaved={draft.highContrast !== snapshot.highContrast}
              help="Perkuat border dan ring fokus supaya elemen lebih terlihat."
              checked={draft.highContrast}
              onChange={(v) => setDraft((d) => ({ ...d, highContrast: v }))}
            />
            <ToggleRow
              label="Kurangi animasi"
              unsaved={draft.reduceMotion !== snapshot.reduceMotion}
              help={
                systemReducedMotion
                  ? "Sistem juga sedang meminta reduce-motion — pengaturan ini menambah cakupan ke animasi in-app."
                  : "Hilangkan slide/fade non-esensial (mis. hint scroll-guard)."
              }
              checked={draft.reduceMotion}
              onChange={(v) => setDraft((d) => ({ ...d, reduceMotion: v }))}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={resetDraft}
            disabled={
              draft.fontScale === DEFAULT_APP_PREFS.fontScale &&
              !draft.highContrast &&
              !draft.reduceMotion
            }
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Kembalikan ke bawaan (draft)
          </Button>
        </div>
      </div>

      {/* Sticky action bar — muncul saat ada perubahan belum disimpan */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur transition-transform ${dirty ? "translate-y-0" : "translate-y-full"}`}
        role="region"
        aria-label="Simpan preferensi aksesibilitas"
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-ms-2 px-ms-4 py-ms-3">
          <p className="text-ms-xs text-muted-foreground">
            Ada perubahan belum disimpan. Aplikasi utama belum berubah.
            <span className="ml-1 hidden sm:inline">
              Pintasan:{" "}
              <kbd className="rounded border bg-muted px-1 py-0.5 text-ms-2xs font-mono">Ctrl</kbd>
              <span className="mx-0.5">+</span>
              <kbd className="rounded border bg-muted px-1 py-0.5 text-ms-2xs font-mono">S</kbd>
              {" "}menyimpan,{" "}
              <kbd className="rounded border bg-muted px-1 py-0.5 text-ms-2xs font-mono">Esc</kbd>
              {" "}membatalkan.
            </span>
          </p>
          <div className="flex gap-ms-2">
            <Button variant="outline" size="sm" onClick={commitCancel} aria-label="Batalkan perubahan" title="Esc">
              <X className="mr-1.5 h-3.5 w-3.5" />
              Batalkan
            </Button>
            <Button size="sm" onClick={commitSave} aria-label="Simpan preferensi" title="Ctrl+S">
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Simpan
            </Button>
          </div>
        </div>
      </div>

      {/* Dialog konfirmasi keluar halaman dengan perubahan belum disimpan */}
      <AlertDialog open={leaveOpen} onOpenChange={(open) => {
        setLeaveOpen(open);
        if (!open) handleLeaveCancel();
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-ms-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
              Perubahan belum disimpan
            </AlertDialogTitle>
            <AlertDialogDescription>
              Anda memiliki perubahan aksesibilitas yang belum disimpan. Jika meninggalkan
              halaman ini, perubahan tersebut akan dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={handleLeaveCancel}>
              Tetap di halaman ini
            </Button>
            <Button variant="destructive" onClick={handleLeaveConfirm}>
              Tinggalkan halaman
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function ToggleRow({
  label,
  help,
  checked,
  onChange,
  unsaved,
}: {
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  unsaved?: boolean;
}) {
  const id = `t-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="flex items-start justify-between gap-ms-4">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="flex items-center gap-ms-2 text-ms-sm font-medium">
          {label}
          {unsaved && <UnsavedDot />}
        </label>
        <p className="text-ms-2xs leading-snug text-muted-foreground">{help}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function UnsavedDot({ title }: { title?: string }) {
  return (
    <span
      className="inline-flex items-center gap-ms-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-ms-2xs font-medium text-amber-700 dark:text-amber-300"
      title={title ?? "Nilai berbeda dari yang tersimpan"}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"
        aria-hidden="true"
      />
      Belum disimpan
    </span>
  );
}