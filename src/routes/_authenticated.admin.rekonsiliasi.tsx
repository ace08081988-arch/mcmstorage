import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useAdminStatus } from "@/hooks/use-is-admin";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, RefreshCw, ShieldAlert, FileWarning, FlaskConical } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/rekonsiliasi")({
  head: () => ({
    meta: [
      { title: "Rekonsiliasi Data · Ace Storage" },
      {
        name: "description",
        content:
          "Laporan hanya-baca untuk paket request yang kehilangan rincian barang sumber dan penanda data uji bernilai nol.",
      },
      { property: "og:title", content: "Rekonsiliasi Data · Ace Storage" },
      {
        property: "og:description",
        content: "Laporan admin hanya-baca untuk rekonsiliasi paket request tanpa rincian barang.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RekonsiliasiPage,
});

type OrphanRow = {
  preparation_id: string;
  created_at: string;
  title_id: string | null;
  title_name: string | null;
  sold_at: string | null;
  sold_total: number | null;
  sold_party_name: string | null;
  reason: string;
  recoverable: boolean;
  suggested_action: string;
  candidate_titles: { title_id: string; name: string }[];
};

type ZeroRow = {
  preparation_id: string;
  created_at: string;
  sold_total: number;
  classification: string;
  note: string;
};

type Report = {
  generated_at: string;
  read_only: boolean;
  orphan_requests: OrphanRow[];
  orphan_count: number;
  zero_value_test_data: ZeroRow[];
  zero_value_count: number;
};

const rupiah = (n: number | null | undefined) =>
  `Rp ${Number(n ?? 0).toLocaleString("id-ID")}`;

const tgl = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

function RekonsiliasiPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc("admin_reconcile_report_v1");
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setReport(data as unknown as Report);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [isAdmin, load]);

  if (isCheckingAdmin) {
    return <div className="p-6 text-sm text-muted-foreground">Memeriksa akses…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          <p className="text-sm font-medium">Halaman ini khusus admin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 pb-24">
      <header className="space-y-2">
        <Link
          to="/pengaturan"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Kembali
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Rekonsiliasi Data</h1>
            <p className="text-sm text-muted-foreground">
              Laporan hanya-baca. Tidak ada data yang diubah, ditebak, atau diisi ulang otomatis.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
            Muat ulang
          </button>
        </div>
      </header>

      {err ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </p>
      ) : null}

      {report ? (
        <>
          <section aria-labelledby="orphan-h" className="space-y-3">
            <h2 id="orphan-h" className="flex items-center gap-2 text-base font-semibold">
              <FileWarning className="h-4 w-4" aria-hidden="true" />
              Paket request tanpa rincian barang ({report.orphan_count})
            </h2>
            {report.orphan_requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada temuan.</p>
            ) : (
              <ul className="space-y-3">
                {report.orphan_requests.map((r) => (
                  <li key={r.preparation_id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{r.title_name ?? "(judul terhapus)"}</span>
                      <span className="text-muted-foreground">{tgl(r.created_at)}</span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <dt className="text-muted-foreground">Nilai tercatat</dt>
                      <dd>{rupiah(r.sold_total)}</dd>
                      <dt className="text-muted-foreground">Pihak</dt>
                      <dd>{r.sold_party_name ?? "—"}</dd>
                      <dt className="text-muted-foreground">Kandidat judul</dt>
                      <dd>
                        {r.candidate_titles.length > 0
                          ? r.candidate_titles.map((c) => c.name).join(", ")
                          : "tidak ada"}
                      </dd>
                    </dl>
                    <p className="mt-2 text-xs text-muted-foreground">{r.reason}</p>
                    <p className="mt-1 text-xs">
                      <span className="font-medium">Tindakan manual:</span> {r.suggested_action}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="zero-h" className="space-y-3">
            <h2 id="zero-h" className="flex items-center gap-2 text-base font-semibold">
              <FlaskConical className="h-4 w-4" aria-hidden="true" />
              Ditandai data uji (nilai nol) ({report.zero_value_count})
            </h2>
            {report.zero_value_test_data.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada temuan.</p>
            ) : (
              <ul className="space-y-2">
                {report.zero_value_test_data.map((z) => (
                  <li key={z.preparation_id} className="rounded-lg border p-3 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="font-mono">{z.preparation_id.slice(0, 8)}…</span>
                      <span className="text-muted-foreground">{tgl(z.created_at)}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{z.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            Dibuat {tgl(report.generated_at)} · mode hanya-baca
          </p>
        </>
      ) : (
        !err && <p className="text-sm text-muted-foreground">Memuat laporan…</p>
      )}
    </div>
  );
}
