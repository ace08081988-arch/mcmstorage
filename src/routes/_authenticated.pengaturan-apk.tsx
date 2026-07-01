import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Package, CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import {
  listApkReleaseAdmin,
  upsertApkReleaseMeta,
  type AdminApkEntry,
} from "@/lib/apk.functions";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
    const rows = data ?? [];
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
          <VariantSection title="MCM Storage" rows={grouped.storage} />
          <VariantSection title="MCM Chat" rows={grouped.chat} />
          {data && data.length === 0 && (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Belum ada berkas APK di bucket.
            </div>
          )}
        </>
      )}
    </div>
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
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Simpan"
            )}
          </Button>
        </div>
      </div>
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
