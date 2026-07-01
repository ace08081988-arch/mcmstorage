import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { HardDrive, Trash2, RefreshCw, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { useAppPrefs } from "@/lib/app-prefs";
import {
  downloadBackup,
  parseBackup,
  applyBackup,
  readFileAsText,
  type PrefsBackup,
} from "@/lib/prefs-backup";
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

export const Route = createFileRoute("/_authenticated/pengaturan-penyimpanan")({
  head: () => ({ meta: [{ title: "Penyimpanan dan Data · MCM Storage" }] }),
  component: PenyimpananPage,
});

function formatKB(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function estimateLocalStorage(): { totalBytes: number; entries: Array<{ key: string; bytes: number }> } {
  if (typeof localStorage === "undefined") return { totalBytes: 0, entries: [] };
  const entries: Array<{ key: string; bytes: number }> = [];
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    const v = localStorage.getItem(k) ?? "";
    const size = k.length + v.length;
    total += size;
    entries.push({ key: k, bytes: size });
  }
  entries.sort((a, b) => b.bytes - a.bytes);
  return { totalBytes: total, entries: entries.slice(0, 8) };
}

function PenyimpananPage() {
  const { prefs, set } = useAppPrefs();
  const [snapshot, setSnapshot] = useState(() => estimateLocalStorage());
  const [quotaMB, setQuotaMB] = useState<number | null>(null);
  const [usedMB, setUsedMB] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<PrefsBackup | null>(null);
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);

  const refresh = async () => {
    setSnapshot(estimateLocalStorage());
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota != null) setQuotaMB(est.quota / (1024 * 1024));
      if (est?.usage != null) setUsedMB(est.usage / (1024 * 1024));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onExport = () => {
    try {
      const b = downloadBackup();
      setLastExportAt(b.exportedAt);
      toast.success("Cadangan preferensi diunduh.");
    } catch (e) {
      toast.error("Gagal membuat cadangan.", {
        description: e instanceof Error ? e.message : "Coba lagi.",
      });
    }
  };

  const onPickFile = () => fileRef.current?.click();

  const onFileChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = ""; // allow re-selecting same file
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const parsed = parseBackup(text);
      if (!parsed.ok) {
        toast.error("File cadangan tidak valid.", { description: parsed.error });
        return;
      }
      setPending(parsed.backup);
    } catch (e) {
      toast.error("Gagal membaca file.", {
        description: e instanceof Error ? e.message : "Coba lagi.",
      });
    }
  };

  const confirmRestore = () => {
    if (!pending) return;
    try {
      applyBackup(pending);
      toast.success("Preferensi dipulihkan dari cadangan.");
      setPending(null);
    } catch (e) {
      toast.error("Gagal memulihkan.", {
        description: e instanceof Error ? e.message : "Coba lagi.",
      });
    }
  };

  const clearNamespace = (prefix: string, label: string) => {
    if (!confirm(`Hapus semua data ${label}?`)) return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    toast.success(`${label}: ${keys.length} entri dihapus.`);
    refresh();
  };

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-8">
      <SettingsHeader title="Penyimpanan dan Data" subtitle="Penggunaan lokal & unduhan otomatis" />
      <div className="space-y-4 px-4 pt-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Penggunaan penyimpanan
            </CardTitle>
            <CardDescription className="text-xs">
              Perkiraan data yang disimpan aplikasi di perangkat ini.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Local storage</div>
                <div className="text-lg font-semibold tabular-nums">
                  {formatKB(snapshot.totalBytes)}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Kuota browser</div>
                <div className="text-lg font-semibold tabular-nums">
                  {usedMB != null && quotaMB != null
                    ? `${usedMB.toFixed(1)} / ${quotaMB.toFixed(0)} MB`
                    : "—"}
                </div>
              </div>
            </div>
            {snapshot.entries.length > 0 && (
              <details className="rounded-md border">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
                  Rincian entri terbesar
                </summary>
                <ul className="divide-y text-xs">
                  {snapshot.entries.map((e) => (
                    <li key={e.key} className="flex items-center justify-between px-3 py-1.5">
                      <span className="truncate font-mono">{e.key}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatKB(e.bytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={refresh}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Segarkan
              </Button>
              <Button size="sm" variant="outline" onClick={() => clearNamespace("mcm.wa-sent", "riwayat WA")}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Hapus riwayat WA
              </Button>
              <Button size="sm" variant="outline" onClick={() => clearNamespace("mcm.sticker", "stiker lokal")}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Hapus cache stiker
              </Button>
              <Button size="sm" variant="outline" onClick={() => clearNamespace("mcm.send-log", "log kirim")}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Hapus log kirim
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Unduh otomatis media</CardTitle>
            <CardDescription className="text-xs">
              Pilih jaringan mana yang otomatis mengunduh foto & lampiran chat.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ToggleRow
              label="Di Wi-Fi"
              help="Foto & stiker terunduh otomatis saat terhubung Wi-Fi."
              checked={prefs.autoDownloadWifi}
              onChange={(v) => set({ autoDownloadWifi: v })}
            />
            <ToggleRow
              label="Di data seluler"
              help="Hati-hati kuota — matikan bila paket data terbatas."
              checked={prefs.autoDownloadCellular}
              onChange={(v) => set({ autoDownloadCellular: v })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cadangan & pulihkan preferensi</CardTitle>
            <CardDescription className="text-xs">
              Ekspor aksesibilitas, bahasa aplikasi, penyimpanan, dan URL integrasi sosial ke satu
              file JSON. Impor kapan saja untuk memulihkan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3 text-[11px] leading-snug text-muted-foreground">
              <div>
                Bahasa: <span className="font-medium text-foreground">{prefs.language.toUpperCase()}</span>
                {" · "}
                Skala font: <span className="font-medium text-foreground">{Math.round(prefs.fontScale * 100)}%</span>
                {" · "}
                Kontras: <span className="font-medium text-foreground">{prefs.highContrast ? "tinggi" : "normal"}</span>
                {" · "}
                Gerakan: <span className="font-medium text-foreground">{prefs.reduceMotion ? "dikurangi" : "normal"}</span>
              </div>
              <div>
                Wi-Fi otomatis:{" "}
                <span className="font-medium text-foreground">{prefs.autoDownloadWifi ? "on" : "off"}</span>
                {" · "}
                Data seluler:{" "}
                <span className="font-medium text-foreground">
                  {prefs.autoDownloadCellular ? "on" : "off"}
                </span>
              </div>
              {lastExportAt && (
                <div className="mt-1">
                  Terakhir diekspor:{" "}
                  <span className="text-foreground">{new Date(lastExportAt).toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onExport}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Ekspor JSON
              </Button>
              <Button size="sm" variant="outline" onClick={onPickFile}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Impor dari file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={onFileChange}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pulihkan preferensi dari cadangan?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                <p>
                  Pengaturan aksesibilitas, bahasa, penyimpanan, dan URL sosial saat ini akan
                  ditimpa oleh isi cadangan.
                </p>
                {pending && (
                  <div className="rounded-md border bg-muted/30 p-2 font-mono text-[11px] text-foreground">
                    <div>Diekspor: {new Date(pending.exportedAt).toLocaleString()}</div>
                    <div>
                      Bahasa {pending.prefs.language.toUpperCase()} · Font{" "}
                      {Math.round(pending.prefs.fontScale * 100)}% · Kontras{" "}
                      {pending.prefs.highContrast ? "tinggi" : "normal"} · Motion{" "}
                      {pending.prefs.reduceMotion ? "reduced" : "normal"}
                    </div>
                    <div>
                      Wi-Fi {pending.prefs.autoDownloadWifi ? "on" : "off"} · Seluler{" "}
                      {pending.prefs.autoDownloadCellular ? "on" : "off"}
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRestore}>Pulihkan</AlertDialogAction>
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
        <label htmlFor={id} className="block text-sm font-medium">{label}</label>
        <p className="text-[11px] leading-snug text-muted-foreground">{help}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}