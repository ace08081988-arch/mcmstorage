import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Package,
  CalendarClock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  History,
  BarChart3,
} from "lucide-react";
import { UploadCloud } from "lucide-react";
import {
  listApkReleaseAdminPanel,
  upsertApkReleaseMeta,
  setApkMinSupported,
  getApkDownloadStats,
  uploadApkRelease,
  type AdminApkEntry,
  type AdminApkListResult,
  type MinSupported,
  type ApkVariant,
  type ApkDownloadStats,
} from "@/lib/apk.functions";
import {
  validateApkFileName,
  type ApkNameValidation,
} from "@/lib/apk-name-validate";
import {
  validateMinSupportedForm,
  hasAnyError,
} from "@/lib/apk-min-validate";
import { useAdminStatus } from "@/hooks/use-is-admin";
import {
  classifyApkAdminView,
  isAdminRequiredError,
} from "@/lib/apk-admin-visibility";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

export const Route = createFileRoute("/_authenticated/pengaturan-apk")({
  head: () => ({ meta: [{ title: "Pengaturan rilis APK — Ace" }] }),
  component: PengaturanApkPage,
});

const emptyNonAdminApkList: AdminApkListResult = {
  isAdmin: false,
  entries: [],
  minSupported: { storage: null, chat: null },
};

function PengaturanApkPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const fetchList = useServerFn(listApkReleaseAdminPanel);
  const { data, isLoading: isLoadingApk, isError, refetch } = useQuery({
    queryKey: ["apk-release-admin"],
    queryFn: async () => {
      try {
        return await fetchList();
      } catch (error) {
        if (isAdminRequiredError(error)) return emptyNonAdminApkList;
        throw error;
      }
    },
    enabled: isAdmin,
    staleTime: 15_000,
    retry: false,
  });
  const isLoading = isCheckingAdmin || (isAdmin && isLoadingApk);

  const grouped = useMemo(() => {
    const rows = data?.entries ?? [];
    return {
      storage: rows.filter((r) => r.variant === "storage"),
      chat: rows.filter((r) => r.variant === "chat"),
    };
  }, [data]);

  return (
    <div className="mx-auto max-w-2xl space-ms-4 p-ms-4">
      <header className="flex items-start gap-ms-3">
        <div className="rounded-xl bg-primary/10 p-ms-2 text-primary">
          <Package className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-ms-base font-semibold leading-tight">
            Pengaturan rilis APK
          </h1>
          <p className="text-ms-xs leading-snug text-muted-foreground">
            Kontrol aktif/nonaktif & jadwal rilis tiap berkas APK di bucket{" "}
            <span className="font-mono">apk-releases</span>. Berkas nonaktif atau
            terjadwal di masa depan disembunyikan dari halaman /download publik.
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center gap-ms-2 rounded-xl border border-dashed p-ms-6 text-ms-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat daftar APK...
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-ms-4 text-ms-sm text-red-700">
          Gagal memuat daftar APK.{" "}
          <button
            className="font-semibold underline"
            onClick={() => refetch()}
            type="button"
          >
            Coba lagi
          </button>
        </div>
      ) : !isAdmin || (data && data.isAdmin === false) ? (
        <div className="rounded-xl border border-warning bg-warning p-ms-4 text-ms-sm text-warning">
          <div className="flex items-start gap-ms-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold leading-snug">Hanya admin</p>
              <p className="text-ms-xs leading-snug">
                Halaman ini khusus admin untuk mengatur jadwal & status rilis
                APK. Minta admin untuk memberikan peran admin ke akun kamu bila
                perlu akses.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <UploadApkCard />
          <MinSupportedCard
            variant="storage"
            title="Ace Storage"
            current={data?.minSupported.storage ?? null}
          />
          <VariantSection title="Ace Storage" rows={grouped.storage} />
          <MinSupportedCard
            variant="chat"
            title="Ace Chat"
            current={data?.minSupported.chat ?? null}
          />
          <VariantSection title="Ace Chat" rows={grouped.chat} />
          <DownloadAnalyticsCard />
          {data && data.entries.length === 0 && (
            <div className="rounded-xl border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">
              Belum ada berkas APK di bucket.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MinSupportedCard({
  variant,
  title,
  current,
}: {
  variant: ApkVariant;
  title: string;
  current: MinSupported | null;
}) {
  const setFn = useServerFn(setApkMinSupported);
  const qc = useQueryClient();
  const [name, setName] = useState(current?.min_version_name ?? "");
  const [code, setCode] = useState<string>(
    current?.min_version_code !== null && current?.min_version_code !== undefined
      ? String(current.min_version_code)
      : "",
  );
  const [reason, setReason] = useState(current?.reason ?? "");
  const [touched, setTouched] = useState({
    name: false,
    code: false,
    reason: false,
  });

  const errors = useMemo(
    () => validateMinSupportedForm({ name, code, reason }),
    [name, code, reason],
  );
  const invalid = hasAnyError(errors);

  const dirty =
    (name || null) !== (current?.min_version_name ?? null) ||
    (code ? Number(code) : null) !== (current?.min_version_code ?? null) ||
    (reason || "") !== (current?.reason ?? "");

  const save = useMutation({
    mutationFn: () =>
      setFn({
        data: {
          variant,
          min_version_name: name.trim() || null,
          min_version_code: code.trim() ? Number.parseInt(code, 10) : null,
          reason: reason.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(`Minimum versi ${title} tersimpan`);
      qc.invalidateQueries({ queryKey: ["apk-release-admin"] });
      qc.invalidateQueries({ queryKey: ["latest-apk-variants"] });
      qc.invalidateQueries({ queryKey: ["apk-variant-detail"] });
    },
    onError: (err: unknown) => {
      if (isAdminRequiredError(err)) {
        toast.error("Akses ditolak — hanya admin yang bisa mengubah minimum versi.");
        return;
      }
      toast.error(
        `Gagal menyimpan: ${err instanceof Error ? err.message : "unknown"}`,
      );
    },
  });

  const attemptSave = () => {
    setTouched({ name: true, code: true, reason: true });
    if (invalid) {
      toast.error("Perbaiki input yang tidak valid dulu");
      return;
    }
    save.mutate();
  };

  return (
    <section className="rounded-xl border bg-card p-ms-3 shadow-sm">
      <header className="flex items-center gap-ms-2">
        <History className="h-4 w-4 text-primary" />
        <h2 className="text-ms-sm font-semibold">
          Minimum versi kompatibel — {title}
        </h2>
      </header>
      <p className="mt-1 text-ms-2xs leading-snug text-muted-foreground">
        Build yang di bawah minimum akan ditandai sebagai lawas / tidak
        kompatibel di halaman unduh. Kosongkan salah satu untuk melewatkan
        pemeriksaannya.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-ms-2">
        <div>
          <label className="text-ms-2xs font-medium">
            Min. versi (semver)
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            placeholder="mis. 1.2.0"
            className={`h-8 font-mono text-ms-xs ${
              touched.name && errors.name
                ? "border-red-500 focus-visible:ring-red-500"
                : ""
            }`}
            aria-invalid={touched.name && !!errors.name}
          />
          {touched.name && errors.name && (
            <p className="mt-1 text-ms-2xs leading-snug text-red-600 dark:text-red-400">
              {errors.name}
            </p>
          )}
        </div>
        <div>
          <label className="text-ms-2xs font-medium">Min. build</label>
          <Input
            value={code}
            inputMode="numeric"
            onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={() => setTouched((t) => ({ ...t, code: true }))}
            placeholder="mis. 45"
            className={`h-8 font-mono text-ms-xs ${
              touched.code && errors.code
                ? "border-red-500 focus-visible:ring-red-500"
                : ""
            }`}
            aria-invalid={touched.code && !!errors.code}
          />
          {touched.code && errors.code && (
            <p className="mt-1 text-ms-2xs leading-snug text-red-600 dark:text-red-400">
              {errors.code}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2">
        <label className="text-ms-2xs font-medium">
          Alasan (opsional, ditampilkan ke user)
        </label>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, reason: true }))}
          placeholder="mis. Perbaikan keamanan penting"
          className={`h-8 text-ms-xs ${
            touched.reason && errors.reason
              ? "border-red-500 focus-visible:ring-red-500"
              : ""
          }`}
          aria-invalid={touched.reason && !!errors.reason}
          maxLength={200}
        />
        {touched.reason && errors.reason && (
          <p className="mt-1 text-ms-2xs leading-snug text-red-600 dark:text-red-400">
            {errors.reason}
          </p>
        )}
      </div>
      {errors.form && (touched.name || touched.code || touched.reason) && (
        <div className="mt-2 flex items-start gap-ms-1.5 rounded-lg border border-red-300 bg-red-50 p-ms-2 text-ms-2xs leading-snug text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{errors.form}</span>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-ms-2">
        <p className="text-ms-2xs text-muted-foreground">
          {current
            ? `Aktif: v${current.min_version_name ?? "-"}${
                current.min_version_code !== null
                  ? ` build ${current.min_version_code}`
                  : ""
              }`
            : "Belum diset — semua build dianggap kompatibel."}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || save.isPending || invalid}
          onClick={attemptSave}
        >
          {save.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "Simpan"
          )}
        </Button>
      </div>
    </section>
  );
}

function VariantSection({
  title,
  rows,
}: {
  title: string;
  rows: AdminApkEntry[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-ms-2">
      <h2 className="text-ms-sm font-semibold">{title}</h2>
      <div className="space-ms-2">
        {rows.map((r) => (
          <ReleaseRow key={r.file_name} entry={r} />
        ))}
      </div>
    </section>
  );
}

function ReleaseRow({ entry }: { entry: AdminApkEntry }) {
  const upsertFn = useServerFn(upsertApkReleaseMeta);
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(entry.enabled);
  const [publishAt, setPublishAt] = useState<string>(
    entry.publish_at ? toLocalInput(entry.publish_at) : "",
  );
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const validation: ApkNameValidation = useMemo(
    () => validateApkFileName(entry.file_name, entry.variant),
    [entry.file_name, entry.variant],
  );
  const hasError = validation.severity === "error";
  const hasWarn = validation.severity !== "ok";

  const dirty =
    enabled !== entry.enabled ||
    (publishAt || null) !==
      (entry.publish_at ? toLocalInput(entry.publish_at) : null) ||
    (notes || "") !== (entry.notes ?? "");

  const save = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          file_name: entry.file_name,
          enabled,
          publish_at: publishAt ? new Date(publishAt).toISOString() : null,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        `Tersimpan (${statusLabel(res.status as AdminApkEntry["status"])})`,
      );
      qc.invalidateQueries({ queryKey: ["apk-release-admin"] });
      qc.invalidateQueries({ queryKey: ["latest-apk-variants"] });
      qc.invalidateQueries({ queryKey: ["apk-variant-detail"] });
    },
    onError: (err: unknown) => {
      if (isAdminRequiredError(err)) {
        toast.error("Akses ditolak — hanya admin yang bisa mengubah rilis APK.");
        return;
      }
      toast.error(
        `Gagal menyimpan: ${err instanceof Error ? err.message : "unknown"}`,
      );
    },
  });

  const requestSave = () => {
    // Blokir keras jika aktif + nama bermasalah — user harus konfirmasi.
    if (enabled && hasWarn) {
      setConfirmOpen(true);
      return;
    }
    save.mutate();
  };

  return (
    <div className="rounded-xl border bg-card p-ms-3 shadow-sm">
      <div className="flex items-start justify-between gap-ms-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-ms-xs">{entry.file_name}</p>
          <p className="text-ms-2xs text-muted-foreground">
            {entry.versionName ? `v${entry.versionName}` : "versi ?"}
            {entry.versionCode !== null && ` · build ${entry.versionCode}`}
            {entry.sizeMB !== null && ` · ${entry.sizeMB} MB`}
          </p>
          <p className="text-ms-2xs text-muted-foreground">
            Upload:{" "}
            {entry.uploadedAt
              ? new Date(entry.uploadedAt).toLocaleString("id-ID")
              : "?"}
          </p>
        </div>
        <StatusBadge status={entry.status} />
      </div>

      {entry.belowMinimum && (
        <div className="mt-3 flex items-start gap-ms-1.5 rounded-lg border border-warning bg-warning p-ms-2.5 text-ms-2xs leading-snug text-warning dark:border-warning/60 dark:bg-warning/40 dark:text-warning">
          <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Build ini di bawah minimum versi yang ditetapkan. User akan
            melihat peringatan tidak kompatibel di halaman unduh.
          </span>
        </div>
      )}

      {hasWarn && (
        <div
          className={`mt-3 rounded-lg border p-ms-2.5 text-ms-2xs leading-snug ${
            hasError
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
              : "border-warning bg-warning text-warning dark:border-warning/60 dark:bg-warning/40 dark:text-warning"
          }`}
        >
          <div className="flex items-start gap-ms-1.5 font-semibold">
            {hasError ? (
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {hasError
                ? "Nama berkas tidak sesuai konvensi"
                : "Peringatan nama berkas"}
            </span>
          </div>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            {validation.issues.map((i) => (
              <li key={i.code}>{i.message}</li>
            ))}
          </ul>
          <p className="mt-1.5 opacity-80">{validation.suggestion}</p>
        </div>
      )}

      <div className="mt-3 space-ms-2 border-t pt-3">
        <label className="flex items-center justify-between gap-ms-3 text-ms-xs">
          <span className="flex items-center gap-ms-2">
            {enabled ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-red-600" />
            )}
            <span className="font-medium">
              {enabled ? "Aktif" : "Nonaktif"}
            </span>
          </span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </label>

        <div className="text-ms-xs">
          <label className="mb-1 flex items-center gap-ms-1.5 font-medium">
            <CalendarClock className="h-3.5 w-3.5" />
            Rilis pada
            <span className="text-muted-foreground">(opsional)</span>
          </label>
          <div className="flex items-center gap-ms-2">
            <Input
              type="datetime-local"
              value={publishAt}
              onChange={(e) => setPublishAt(e.target.value)}
              className="h-8 text-ms-xs"
              disabled={!enabled}
            />
            {publishAt && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-ms-2xs"
                onClick={() => setPublishAt("")}
              >
                Sekarang
              </Button>
            )}
          </div>
          <p className="mt-1 text-ms-2xs leading-snug text-muted-foreground">
            Kosongkan untuk langsung dipublikasikan. Isi waktu masa depan untuk
            menahan rilis sampai jadwal.
          </p>
        </div>

        <div className="text-ms-xs">
          <label className="mb-1 block font-medium">Catatan internal</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-16 text-ms-xs"
            placeholder="Mis. hotfix, RC1, siap uji beta..."
            maxLength={500}
          />
        </div>

        <div className="flex justify-end gap-ms-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setEnabled(entry.enabled);
              setPublishAt(
                entry.publish_at ? toLocalInput(entry.publish_at) : "",
              );
              setNotes(entry.notes ?? "");
            }}
          >
            Reset
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={requestSave}
          >
            {save.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Simpan"
            )}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-ms-2">
              {hasError ? (
                <ShieldAlert className="h-4 w-4 text-red-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-warning" />
              )}
              Rilis berkas dengan nama bermasalah?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-ms-2 text-ms-xs">
                <p className="font-mono break-all">{entry.file_name}</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {validation.issues.map((i) => (
                    <li key={i.code}>
                      <span
                        className={
                          i.severity === "error"
                            ? "text-red-700 dark:text-red-300"
                            : "text-warning dark:text-warning"
                        }
                      >
                        {i.message}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground">
                  {hasError
                    ? "Berkas ini kemungkinan besar akan salah dikelompokkan di halaman /download. Rekomendasi: rename berkas di bucket sebelum dirilis."
                    : "Rilis tetap bisa dilanjutkan, namun sebagian info versi mungkin tidak tampil."}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className={
                hasError
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              onClick={() => {
                setConfirmOpen(false);
                save.mutate();
              }}
            >
              {hasError ? "Rilis paksa" : "Tetap simpan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusBadge({ status }: { status: AdminApkEntry["status"] }) {
  const map = {
    published: "bg-success/10 text-success dark:text-success",
    scheduled: "bg-warning/10 text-warning dark:text-warning",
    disabled: "bg-red-600/10 text-red-700 dark:text-red-300",
  } as const;
  return (
    <span
      className={`shrink-0 rounded-full px-ms-2 py-0.5 text-ms-2xs font-semibold uppercase ${map[status]}`}
    >
      {statusLabel(status)}
    </span>
  );
}

function statusLabel(s: AdminApkEntry["status"]) {
  return s === "published"
    ? "Terbit"
    : s === "scheduled"
      ? "Terjadwal"
      : "Nonaktif";
}

/** Konversi ISO ke value input `datetime-local` di zona waktu perangkat. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

// -------- Analitik klik unduh APK --------
function DownloadAnalyticsCard() {
  const fetchStats = useServerFn(getApkDownloadStats);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["apk-download-stats"],
    queryFn: () => fetchStats() as Promise<ApkDownloadStats>,
    staleTime: 30_000,
    retry: false,
  });

  const totals = data?.totals;
  const chatBtn = totals?.chat.button ?? 0;
  const storageBtn = totals?.storage.button ?? 0;
  const btnTotal = chatBtn + storageBtn;
  const chatShare = btnTotal > 0 ? Math.round((chatBtn / btnTotal) * 100) : 0;

  return (
    <div className="rounded-xl border bg-card p-ms-4 shadow-sm">
      <div className="mb-3 flex items-center gap-ms-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <h3 className="text-ms-sm font-semibold">Analitik klik unduh (30 hari)</h3>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto text-ms-2xs font-medium text-muted-foreground hover:text-foreground"
        >
          {isFetching ? "Memuat…" : "Segarkan"}
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-ms-2 text-ms-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat data…
        </div>
      ) : isError ? (
        <div className="text-ms-xs text-red-600">Gagal memuat data analitik.</div>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 gap-ms-2">
            <StatTile
              label="Ace Storage — tombol"
              value={storageBtn}
              totalHint={`Semua: ${totals?.storage.total ?? 0}`}
              tone="emerald"
            />
            <StatTile
              label="Ace Chat — tombol"
              value={chatBtn}
              totalHint={`Semua: ${totals?.chat.total ?? 0}`}
              tone="sky"
            />
          </div>
          <p className="mt-2 text-ms-2xs text-muted-foreground">
            Konversi klik tombol unduh: Ace Chat {chatShare}% dari total{" "}
            {btnTotal}. Data mencakup 30 hari terakhir.
          </p>

          <div className="mt-3 overflow-hidden rounded-lg border">
            <table className="w-full text-ms-2xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-ms-2 py-1.5 font-medium">Varian</th>
                  <th className="px-ms-2 py-1.5 font-medium">Sumber</th>
                  <th className="px-ms-2 py-1.5 text-right font-medium">24 jam</th>
                  <th className="px-ms-2 py-1.5 text-right font-medium">7 hari</th>
                  <th className="px-ms-2 py-1.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-ms-2 py-ms-3 text-center text-muted-foreground">
                      Belum ada klik tercatat.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((r) => (
                    <tr key={`${r.variant}:${r.source}`} className="border-t">
                      <td className="px-ms-2 py-1.5 capitalize">{r.variant}</td>
                      <td className="px-ms-2 py-1.5 text-muted-foreground">
                        {sourceLabel(r.source)}
                      </td>
                      <td className="px-ms-2 py-1.5 text-right font-mono">{r.last24h}</td>
                      <td className="px-ms-2 py-1.5 text-right font-mono">{r.last7d}</td>
                      <td className="px-ms-2 py-1.5 text-right font-mono font-semibold">
                        {r.total}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  totalHint,
  tone,
}: {
  label: string;
  value: number;
  totalHint: string;
  tone: "emerald" | "sky";
}) {
  const cls =
    tone === "emerald"
      ? "border-success/60 bg-success dark:border-success/60 dark:bg-success/30"
      : "border-sky-300/60 bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/30";
  return (
    <div className={`rounded-lg border p-ms-2.5 ${cls}`}>
      <div className="text-ms-2xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-ms-lg font-semibold">{value}</div>
      <div className="text-ms-2xs text-muted-foreground">{totalHint}</div>
    </div>
  );
}

function sourceLabel(s: "button" | "copy_page" | "copy_file"): string {
  if (s === "button") return "Tombol unduh";
  if (s === "copy_page") return "Salin link halaman";
  return "Salin link file";
}

// ============================================================================
// Panel unggah APK baru
// ============================================================================
function UploadApkCard() {
  const uploadFn = useServerFn(uploadApkRelease);
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [variant, setVariant] = useState<ApkVariant>("chat");
  const [overwrite, setOverwrite] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  const validation: ApkNameValidation | null = useMemo(
    () => (file ? validateApkFileName(file.name, variant) : null),
    [file, variant],
  );

  const sizeMB = file ? Math.round((file.size / (1024 * 1024)) * 10) / 10 : null;
  const canSubmit = !!file && (!validation || validation.severity !== "error") && !busy;

  async function onSubmit() {
    if (!file) return;
    setBusy(true);
    const toastId = toast.loading(`Mengunggah ${file.name}…`);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("variant", variant);
      fd.append("overwrite", overwrite ? "1" : "0");
      fd.append("enabled", enabled ? "1" : "0");
      const res = await uploadFn({ data: fd });
      toast.success(
        `APK ${res.variant === "chat" ? "Chat" : "Storage"} terunggah • ${res.sizeMB ?? "?"} MB`,
        { id: toastId },
      );
      setFile(null);
      setOverwrite(false);
      qc.invalidateQueries({ queryKey: ["apk-release-admin"] });
      qc.invalidateQueries({ queryKey: ["latest-apk-variants"] });
      qc.invalidateQueries({ queryKey: ["apk-variant-detail"] });
    } catch (err) {
      toast.error(
        `Gagal unggah: ${err instanceof Error ? err.message : "unknown"}`,
        { id: toastId },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-ms-3 shadow-sm">
      <header className="flex items-center gap-ms-2">
        <UploadCloud className="h-4 w-4 text-primary" />
        <h2 className="text-ms-sm font-semibold">Unggah berkas APK baru</h2>
      </header>
      <p className="mt-1 text-ms-2xs leading-snug text-muted-foreground">
        Pilih berkas <span className="font-mono">.apk</span> dan varian target. Berkas akan diunggah ke bucket{" "}
        <span className="font-mono">apk-releases</span>. Untuk varian <b>Chat</b>, nama file wajib memuat token{" "}
        <span className="font-mono">chat</span> (mis. <span className="font-mono">mcm-chat-v1.0.0-1.apk</span>).
      </p>

      <div className="mt-3 space-ms-3">
        <div>
          <label className="text-ms-2xs font-medium">Varian</label>
          <div className="mt-1 grid grid-cols-2 gap-ms-2">
            {(["storage", "chat"] as ApkVariant[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVariant(v)}
                className={`rounded-lg border px-ms-3 py-ms-2 text-ms-xs font-medium transition ${
                  variant === v
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                {v === "chat" ? "Ace Chat" : "Ace Storage"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-ms-2xs font-medium" htmlFor="apk-file-input">
            Berkas .apk
          </label>
          <Input
            id="apk-file-input"
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 h-9 cursor-pointer text-ms-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-ms-3 file:py-1.5 file:text-ms-xs file:font-medium file:text-primary-foreground"
          />
          {file && (
            <p className="mt-1 truncate font-mono text-ms-2xs text-muted-foreground">
              {file.name} • {sizeMB ?? "?"} MB
            </p>
          )}
        </div>

        {validation && validation.issues.length > 0 && (
          <div
            className={`rounded-lg border p-ms-2 text-ms-2xs leading-snug ${
              validation.severity === "error"
                ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
                : "border-warning bg-warning text-warning dark:border-warning/60 dark:bg-warning/40 dark:text-warning"
            }`}
          >
            <div className="flex items-start gap-ms-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 space-y-1">
                {validation.issues.map((i, idx) => (
                  <p key={idx}>{i.message}</p>
                ))}
                <p className="text-ms-2xs opacity-80">{validation.suggestion}</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex cursor-pointer items-center gap-ms-2 text-ms-xs">
            <Switch checked={overwrite} onCheckedChange={setOverwrite} />
            <span>Timpa jika nama sama</span>
          </label>
          <label className="flex cursor-pointer items-center gap-ms-2 text-ms-xs">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <span>Langsung publish</span>
          </label>
        </div>

        <div className="flex justify-end">
          <Button type="button" size="sm" disabled={!canSubmit} onClick={onSubmit}>
            {busy ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Mengunggah…
              </>
            ) : (
              <>
                <UploadCloud className="mr-1.5 h-3.5 w-3.5" />
                Unggah APK
              </>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}
