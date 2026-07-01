import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { HardDrive, Trash2, RefreshCw, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2 } from "lucide-react";
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
  const [pendingClear, setPendingClear] = useState<{
    prefix: string;
    label: string;
    keys: Array<{ key: string; bytes: number }>;
    totalBytes: number;
  } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [clearProgress, setClearProgress] = useState<{
    phase: "idle" | "processing" | "done";
    done: number;
    total: number;
    currentKey: string;
    freedBytes: number;
  }>({ phase: "idle", done: 0, total: 0, currentKey: "", freedBytes: 0 });
  const [clearPage, setClearPage] = useState(1);
  const [clearExpanded, setClearExpanded] = useState(false);
  const CLEAR_PAGE_SIZE = 10;
  const AUTO_BACKUP_KEY = "mcm.autoBackupBeforeClear";
  const [backupBeforeClear, setBackupBeforeClear] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(AUTO_BACKUP_KEY) !== "0";
  });
  useEffect(() => {
    try {
      localStorage.setItem(AUTO_BACKUP_KEY, backupBeforeClear ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [backupBeforeClear]);

  function exportKeysBackup(
    label: string,
    prefix: string,
    entries: Array<{ key: string; bytes: number }>,
  ) {
    const payload = {
      kind: "mcm-local-keys-backup",
      version: 1,
      label,
      prefix,
      exportedAt: new Date().toISOString(),
      count: entries.length,
      entries: entries.map((e) => ({
        key: e.key,
        value: localStorage.getItem(e.key),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `mcm-backup-${slug}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

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

  const requestClear = (prefix: string, label: string) => {
    const keys: Array<{ key: string; bytes: number }> = [];
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const v = localStorage.getItem(k) ?? "";
      const size = k.length + v.length;
      total += size;
      keys.push({ key: k, bytes: size });
    }
    keys.sort((a, b) => b.bytes - a.bytes);
    if (keys.length === 0) {
      toast.info(`${label}: tidak ada data untuk dihapus.`);
      return;
    }
    setPendingClear({ prefix, label, keys, totalBytes: total });
    setSelectedKeys(new Set(keys.map((k) => k.key)));
    setClearPage(1);
    setClearExpanded(false);
  };

  const confirmClear = async () => {
    if (!pendingClear) return;
    const { keys, label } = pendingClear;
    const chosen = keys.filter((e) => selectedKeys.has(e.key));
    if (chosen.length === 0) {
      toast.info("Tidak ada entri yang dipilih.");
      return;
    }
    if (backupBeforeClear) {
      try {
        exportKeysBackup(label, pendingClear.prefix, chosen);
        toast.success("Cadangan diunduh sebelum menghapus.");
      } catch (e) {
        toast.error("Gagal ekspor cadangan — penghapusan dibatalkan.", {
          description: e instanceof Error ? e.message : "Coba lagi.",
        });
        return;
      }
    }
    // Snapshot values BEFORE removal so undo can restore them.
    const snapshotForUndo: Array<{ key: string; value: string }> = chosen
      .map((e) => ({ key: e.key, value: localStorage.getItem(e.key) ?? "" }))
      .filter((e) => e.value !== null);
    setClearProgress({
      phase: "processing",
      done: 0,
      total: chosen.length,
      currentKey: chosen[0]?.key ?? "",
      freedBytes: 0,
    });
    let freed = 0;
    // Chunk deletion so the UI can paint progress between batches.
    const batchSize = Math.max(1, Math.ceil(chosen.length / 20));
    for (let i = 0; i < chosen.length; i += batchSize) {
      const slice = chosen.slice(i, i + batchSize);
      for (const e of slice) {
        localStorage.removeItem(e.key);
        freed += e.bytes;
      }
      const done = Math.min(i + batchSize, chosen.length);
      setClearProgress({
        phase: "processing",
        done,
        total: chosen.length,
        currentKey: slice[slice.length - 1]?.key ?? "",
        freedBytes: freed,
      });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    setClearProgress((p) => ({ ...p, phase: "done", currentKey: "" }));
    let undone = false;
    const undoToastId = toast.success(`${label} dihapus`, {
      description: `${chosen.length} dari ${keys.length} entri · ${formatKB(freed)} dibebaskan.`,
      duration: 10000,
      action: {
        label: "Batalkan",
        onClick: () => {
          if (undone) return;
          undone = true;
          let restored = 0;
          for (const item of snapshotForUndo) {
            try {
              localStorage.setItem(item.key, item.value);
              restored++;
            } catch {
              /* quota — skip */
            }
          }
          toast.success("Penghapusan dibatalkan", {
            description: `${restored} entri dipulihkan.`,
          });
          refresh();
        },
      },
    });
    void undoToastId;
    await refresh();
    // Show "selesai" briefly before closing.
    setTimeout(() => {
      setPendingClear(null);
      setSelectedKeys(new Set());
      setClearProgress({ phase: "idle", done: 0, total: 0, currentKey: "", freedBytes: 0 });
    }, 900);
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
              <Button size="sm" variant="outline" onClick={() => requestClear("mcm.wa-sent", "Riwayat MCM")}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Hapus riwayat MCM
              </Button>
              <Button size="sm" variant="outline" onClick={() => requestClear("mcm.sticker", "Cache stiker")}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Hapus cache stiker
              </Button>
              <Button size="sm" variant="outline" onClick={() => requestClear("mcm.send-log", "Log kirim")}>
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
                {pending && <BackupSummary pending={pending} current={prefs} />}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRestore}>Pulihkan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingClear}
        onOpenChange={(o) => {
          if (o) return;
          if (clearProgress.phase === "processing") return; // block close while running
          setPendingClear(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Hapus {pendingClear?.label.toLowerCase() ?? "data"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                {clearProgress.phase !== "idle" && (
                  <div className="rounded-md border bg-muted/40 p-2 text-[11px]">
                    <div className="mb-1 flex items-center justify-between font-medium">
                      <span className="flex items-center gap-1.5">
                        {clearProgress.phase === "processing" ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                            Memproses…
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            Selesai
                          </>
                        )}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {clearProgress.done}/{clearProgress.total} · {formatKB(clearProgress.freedBytes)}
                      </span>
                    </div>
                    <Progress
                      value={
                        clearProgress.total > 0
                          ? (clearProgress.done / clearProgress.total) * 100
                          : 0
                      }
                      className="h-1.5"
                    />
                    {clearProgress.phase === "processing" && clearProgress.currentKey && (
                      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                        {clearProgress.currentKey}
                      </p>
                    )}
                  </div>
                )}
                <p>
                  Aksi ini menghapus data dari perangkat ini saja dan tidak bisa dibatalkan.
                  Data di server (jika ada) tidak terpengaruh.
                </p>
                {pendingClear && (
                  <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-foreground">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Dipilih</span>
                      <span className="font-medium tabular-nums">
                        {selectedKeys.size} / {pendingClear.keys.length} entri ·{" "}
                        {formatKB(
                          pendingClear.keys
                            .filter((e) => selectedKeys.has(e.key))
                            .reduce((s, e) => s + e.bytes, 0),
                        )}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-2">
                      <button
                        type="button"
                        className="text-[11px] text-primary underline"
                        onClick={() =>
                          setSelectedKeys(new Set(pendingClear.keys.map((k) => k.key)))
                        }
                      >
                        Pilih semua
                      </button>
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground underline"
                        onClick={() => setSelectedKeys(new Set())}
                      >
                        Kosongkan
                      </button>
                    </div>
                    <div className="mt-2 flex items-start justify-between gap-2 rounded border bg-background p-2">
                      <label className="flex items-start gap-2 text-[11px] leading-snug">
                        <Checkbox
                          checked={backupBeforeClear}
                          onCheckedChange={(v) => setBackupBeforeClear(Boolean(v))}
                          disabled={clearProgress.phase === "processing"}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-medium text-foreground">
                            Ekspor cadangan JSON sebelum hapus
                          </span>
                          <span className="block text-muted-foreground">
                            Berisi {selectedKeys.size} entri terpilih; bisa diimpor manual jika perlu.
                          </span>
                        </span>
                      </label>
                      <button
                        type="button"
                        className="shrink-0 text-[11px] text-primary underline disabled:opacity-40"
                        disabled={
                          selectedKeys.size === 0 || clearProgress.phase === "processing"
                        }
                        onClick={() => {
                          try {
                            const chosen = pendingClear.keys.filter((e) =>
                              selectedKeys.has(e.key),
                            );
                            exportKeysBackup(
                              pendingClear.label,
                              pendingClear.prefix,
                              chosen,
                            );
                            toast.success("Cadangan diunduh.");
                          } catch (e) {
                            toast.error("Gagal ekspor cadangan.", {
                              description:
                                e instanceof Error ? e.message : "Coba lagi.",
                            });
                          }
                        }}
                      >
                        Ekspor sekarang
                      </button>
                    </div>
                    {(() => {
                      const total = pendingClear.keys.length;
                      const totalPages = Math.max(1, Math.ceil(total / CLEAR_PAGE_SIZE));
                      const page = Math.min(clearPage, totalPages);
                      const visible = clearExpanded
                        ? pendingClear.keys
                        : pendingClear.keys.slice(
                            (page - 1) * CLEAR_PAGE_SIZE,
                            page * CLEAR_PAGE_SIZE,
                          );
                      return (
                        <>
                          <div
                            className={
                              clearExpanded
                                ? "mt-2 max-h-64 overflow-auto rounded border bg-background"
                                : "mt-2 rounded border bg-background"
                            }
                          >
                            <ul className="divide-y">
                              {visible.map((e) => {
                                const checked = selectedKeys.has(e.key);
                                return (
                                  <li
                                    key={e.key}
                                    className="flex items-center gap-2 px-2 py-1 font-mono text-[11px]"
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(v) => {
                                        setSelectedKeys((prev) => {
                                          const next = new Set(prev);
                                          if (v) next.add(e.key);
                                          else next.delete(e.key);
                                          return next;
                                        });
                                      }}
                                    />
                                    <span className="flex-1 truncate">{e.key}</span>
                                    <span className="shrink-0 tabular-nums text-muted-foreground">
                                      {formatKB(e.bytes)}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                          {total > CLEAR_PAGE_SIZE && (
                            <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                              {clearExpanded ? (
                                <button
                                  type="button"
                                  className="text-primary underline"
                                  onClick={() => setClearExpanded(false)}
                                >
                                  Ciutkan
                                </button>
                              ) : (
                                <>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={page <= 1}
                                      onClick={() => setClearPage((p) => Math.max(1, p - 1))}
                                      className="rounded border px-1.5 py-0.5 disabled:opacity-40"
                                    >
                                      ‹
                                    </button>
                                    <span className="tabular-nums text-muted-foreground">
                                      {page}/{totalPages}
                                    </span>
                                    <button
                                      type="button"
                                      disabled={page >= totalPages}
                                      onClick={() =>
                                        setClearPage((p) => Math.min(totalPages, p + 1))
                                      }
                                      className="rounded border px-1.5 py-0.5 disabled:opacity-40"
                                    >
                                      ›
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    className="text-primary underline"
                                    onClick={() => setClearExpanded(true)}
                                  >
                                    Tampilkan semua ({total})
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearProgress.phase === "processing"}>
              {clearProgress.phase === "done" ? "Tutup" : "Batal"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmClear}
              disabled={selectedKeys.size === 0 || clearProgress.phase !== "idle"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {clearProgress.phase === "processing" ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Memproses…
                </>
              ) : clearProgress.phase === "done" ? (
                <>
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Selesai
                </>
              ) : (
                <>Hapus{selectedKeys.size > 0 ? ` (${selectedKeys.size})` : ""}</>
              )}
            </AlertDialogAction>
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

function BackupSummary({
  pending,
  current,
}: {
  pending: PrefsBackup;
  current: import("@/lib/app-prefs").AppPrefs;
}) {
  const p = pending.prefs;
  const rows: Array<{ label: string; group: string; cur: string; next: string }> = [
    { group: "Aksesibilitas", label: "Skala font", cur: `${Math.round(current.fontScale * 100)}%`, next: `${Math.round(p.fontScale * 100)}%` },
    { group: "Aksesibilitas", label: "Kontras tinggi", cur: current.highContrast ? "on" : "off", next: p.highContrast ? "on" : "off" },
    { group: "Aksesibilitas", label: "Kurangi gerakan", cur: current.reduceMotion ? "on" : "off", next: p.reduceMotion ? "on" : "off" },
    { group: "Bahasa", label: "Bahasa aplikasi", cur: current.language.toUpperCase(), next: p.language.toUpperCase() },
    { group: "Penyimpanan", label: "Auto-unduh Wi-Fi", cur: current.autoDownloadWifi ? "on" : "off", next: p.autoDownloadWifi ? "on" : "off" },
    { group: "Penyimpanan", label: "Auto-unduh seluler", cur: current.autoDownloadCellular ? "on" : "off", next: p.autoDownloadCellular ? "on" : "off" },
    { group: "Integrasi sosial", label: "Facebook URL", cur: current.facebookUrl || "—", next: p.facebookUrl || "—" },
    { group: "Integrasi sosial", label: "Instagram URL", cur: current.instagramUrl || "—", next: p.instagramUrl || "—" },
  ];
  const changed = rows.filter((r) => r.cur !== r.next).length;
  const groups = Array.from(new Set(rows.map((r) => r.group)));
  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">Diekspor</span>
          <span className="font-medium">{new Date(pending.exportedAt).toLocaleString()}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">Versi cadangan</span>
          <span className="font-medium tabular-nums">v{pending.version}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">Field berubah</span>
          <span className={`font-medium tabular-nums ${changed > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
            {changed} / {rows.length}
          </span>
        </div>
      </div>
      <div className="max-h-64 overflow-auto rounded-md border bg-background">
        {groups.map((g) => (
          <div key={g} className="border-b last:border-b-0">
            <div className="bg-muted/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {g}
            </div>
            <ul className="divide-y">
              {rows
                .filter((r) => r.group === g)
                .map((r) => {
                  const diff = r.cur !== r.next;
                  return (
                    <li key={r.label} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-2 py-1.5">
                      <span className="truncate text-[11px]">{r.label}</span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground line-through max-w-[9rem]">
                        {r.cur}
                      </span>
                      <span className="text-[10px] text-muted-foreground">→</span>
                      <span
                        className={`truncate font-mono text-[11px] max-w-[9rem] ${diff ? "font-semibold text-amber-600 dark:text-amber-400" : "text-foreground"}`}
                      >
                        {r.next}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
      {changed === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Isi cadangan identik dengan pengaturan saat ini — memulihkan tidak akan mengubah apa pun.
        </p>
      )}
    </div>
  );
}