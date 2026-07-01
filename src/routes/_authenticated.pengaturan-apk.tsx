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
} from "lucide-react";
import {
  listApkReleaseAdmin,
  upsertApkReleaseMeta,
  setApkMinSupported,
  type AdminApkEntry,
  type MinSupported,
  type ApkVariant,
} from "@/lib/apk.functions";
import {
  validateApkFileName,
  type ApkNameValidation,
} from "@/lib/apk-name-validate";
import {
  validateMinSupportedForm,
  hasAnyError,
} from "@/lib/apk-min-validate";
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
  head: () => ({ meta: [{ title: "Pengaturan rilis APK — MCM" }] }),
  component: PengaturanApkPage,
});

function PengaturanApkPage() {
  const fetchList = useServerFn(listApkReleaseAdmin);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["apk-release-admin"],
    queryFn: () => fetchList(),
    staleTime: 15_000,
  });

  const grouped = useMemo(() => {
    const rows = data?.entries ?? [];
    return {
      storage: rows.filter((r) => r.variant === "storage"),
      chat: rows.filter((r) => r.variant === "chat"),
    };
  }, [data]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <Package className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold leading-tight">
            Pengaturan rilis APK
          </h1>
          <p className="text-xs leading-snug text-muted-foreground">
            Kontrol aktif/nonaktif & jadwal rilis tiap berkas APK di bucket{" "}
            <span className="font-mono">apk-releases</span>. Berkas nonaktif atau
            terjadwal di masa depan disembunyikan dari halaman /download publik.
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat daftar APK...
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          Gagal memuat daftar APK.{" "}
          <button
            className="font-semibold underline"
            onClick={() => refetch()}
            type="button"
          >
            Coba lagi
          </button>
        </div>
      ) : (
        <>
          <MinSupportedCard
            variant="storage"
            title="MCM Storage"
            current={data?.minSupported.storage ?? null}
          />
          <VariantSection title="MCM Storage" rows={grouped.storage} />
          <MinSupportedCard
            variant="chat"
            title="MCM Chat"
            current={data?.minSupported.chat ?? null}
          />
          <VariantSection title="MCM Chat" rows={grouped.chat} />
          {data && data.entries.length === 0 && (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
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
    <section className="rounded-xl border bg-card p-3 shadow-sm">
      <header className="flex items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">
          Minimum versi kompatibel — {title}
        </h2>
      </header>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Build yang di bawah minimum akan ditandai sebagai lawas / tidak
        kompatibel di halaman unduh. Kosongkan salah satu untuk melewatkan
        pemeriksaannya.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-medium">
            Min. versi (semver)
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            placeholder="mis. 1.2.0"
            className={`h-8 font-mono text-xs ${
              touched.name && errors.name
                ? "border-red-500 focus-visible:ring-red-500"
                : ""
            }`}
            aria-invalid={touched.name && !!errors.name}
          />
          {touched.name && errors.name && (
            <p className="mt-1 text-[11px] leading-snug text-red-600 dark:text-red-400">
              {errors.name}
            </p>
          )}
        </div>
        <div>
          <label className="text-[11px] font-medium">Min. build</label>
          <Input
            value={code}
            inputMode="numeric"
            onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={() => setTouched((t) => ({ ...t, code: true }))}
            placeholder="mis. 45"
            className={`h-8 font-mono text-xs ${
              touched.code && errors.code
                ? "border-red-500 focus-visible:ring-red-500"
                : ""
            }`}
            aria-invalid={touched.code && !!errors.code}
          />
          {touched.code && errors.code && (
            <p className="mt-1 text-[11px] leading-snug text-red-600 dark:text-red-400">
              {errors.code}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2">
        <label className="text-[11px] font-medium">
          Alasan (opsional, ditampilkan ke user)
        </label>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, reason: true }))}
          placeholder="mis. Perbaikan keamanan penting"
          className={`h-8 text-xs ${
            touched.reason && errors.reason
              ? "border-red-500 focus-visible:ring-red-500"
              : ""
          }`}
          aria-invalid={touched.reason && !!errors.reason}
          maxLength={200}
        />
        {touched.reason && errors.reason && (
          <p className="mt-1 text-[11px] leading-snug text-red-600 dark:text-red-400">
            {errors.reason}
          </p>
        )}
      </div>
      {errors.form && (touched.name || touched.code || touched.reason) && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-300 bg-red-50 p-2 text-[11px] leading-snug text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{errors.form}</span>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
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
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="space-y-2">
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
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs">{entry.file_name}</p>
          <p className="text-[11px] text-muted-foreground">
            {entry.versionName ? `v${entry.versionName}` : "versi ?"}
            {entry.versionCode !== null && ` · build ${entry.versionCode}`}
            {entry.sizeMB !== null && ` · ${entry.sizeMB} MB`}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Upload:{" "}
            {entry.uploadedAt
              ? new Date(entry.uploadedAt).toLocaleString("id-ID")
              : "?"}
          </p>
        </div>
        <StatusBadge status={entry.status} />
      </div>

      {entry.belowMinimum && (
        <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] leading-snug text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Build ini di bawah minimum versi yang ditetapkan. User akan
            melihat peringatan tidak kompatibel di halaman unduh.
          </span>
        </div>
      )}

      {hasWarn && (
        <div
          className={`mt-3 rounded-lg border p-2.5 text-[11px] leading-snug ${
            hasError
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
          }`}
        >
          <div className="flex items-start gap-1.5 font-semibold">
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

      <div className="mt-3 space-y-2 border-t pt-3">
        <label className="flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-2">
            {enabled ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-red-600" />
            )}
            <span className="font-medium">
              {enabled ? "Aktif" : "Nonaktif"}
            </span>
          </span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </label>

        <div className="text-xs">
          <label className="mb-1 flex items-center gap-1.5 font-medium">
            <CalendarClock className="h-3.5 w-3.5" />
            Rilis pada
            <span className="text-muted-foreground">(opsional)</span>
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="datetime-local"
              value={publishAt}
              onChange={(e) => setPublishAt(e.target.value)}
              className="h-8 text-xs"
              disabled={!enabled}
            />
            {publishAt && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-[11px]"
                onClick={() => setPublishAt("")}
              >
                Sekarang
              </Button>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Kosongkan untuk langsung dipublikasikan. Isi waktu masa depan untuk
            menahan rilis sampai jadwal.
          </p>
        </div>

        <div className="text-xs">
          <label className="mb-1 block font-medium">Catatan internal</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-16 text-xs"
            placeholder="Mis. hotfix, RC1, siap uji beta..."
            maxLength={500}
          />
        </div>

        <div className="flex justify-end gap-2">
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
            <AlertDialogTitle className="flex items-center gap-2">
              {hasError ? (
                <ShieldAlert className="h-4 w-4 text-red-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
              Rilis berkas dengan nama bermasalah?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs">
                <p className="font-mono break-all">{entry.file_name}</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {validation.issues.map((i) => (
                    <li key={i.code}>
                      <span
                        className={
                          i.severity === "error"
                            ? "text-red-700 dark:text-red-300"
                            : "text-amber-700 dark:text-amber-300"
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
                  ? "bg-red-600 text-white hover:bg-red-700"
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
    published: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-300",
    scheduled: "bg-amber-600/10 text-amber-700 dark:text-amber-300",
    disabled: "bg-red-600/10 text-red-700 dark:text-red-300",
  } as const;
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${map[status]}`}
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
