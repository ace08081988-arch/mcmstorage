import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, ChevronLeft, Search, ExternalLink, Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  countActiveByTitle,
  filterActivePreps,
  filterSentPreps,
  countActivePreps,
  isActivePrep,
  isSentPrep,
} from "@/lib/prep-active-selector";
import { toast } from "sonner";

/**
 * Halaman debug internal: `/debug/selector`.
 *
 * Menampilkan jumlah paket AKTIF vs TERKIRIM per `title_id` untuk kedua
 * domain (request + ecer) berdasarkan SATU-SATUNYA sumber kebenaran:
 * helper di `@/lib/prep-active-selector`. Tujuan:
 *   1. Verifikasi cepat saat data berubah (mis. abis Tandai Terkirim /
 *      Batalkan Terkirim) apakah angka badge di seluruh app konsisten.
 *   2. Alat troubleshooting kalau ada laporan "badge tidak sinkron" —
 *      halaman ini adalah patokan yang harus dicocokkan.
 *
 * TIDAK di-index (noindex,nofollow) dan hanya dapat diakses dari dalam
 * layout `_authenticated`. Tidak mengekspos PII: hanya title id/nama +
 * angka.
 */
export const Route = createFileRoute("/_authenticated/debug/selector")({
  head: () => ({
    meta: [
      { title: "Debug Selector · MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DebugSelectorPage,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Title = { id: string; name: string };
type Prep = { id: string; title_id: string; sold_at: string | null };

type Row = {
  title_id: string;
  name: string;
  active: number;
  sent: number;
  total: number;
};

type Domain = "request" | "ecer";

type LoadedDomain = {
  titles: Title[];
  preps: Prep[];
};

async function loadDomain(domain: Domain): Promise<LoadedDomain> {
  const titleTable = domain === "request" ? "request_titles" : "ecer_titles";
  const prepTable = domain === "request" ? "request_preparations" : "ecer_preparations";
  const [tRes, pRes] = await Promise.all([
    sb.from(titleTable).select("id,name"),
    // Ambil SEMUA prep (aktif + sent) supaya halaman ini bisa membandingkan
    // hasil selector dengan agregat mentah. Sengaja TIDAK memakai
    // `withActivePrepsFilter` — tujuan halaman ini adalah audit, bukan badge.
    sb.from(prepTable).select("id,title_id,sold_at"),
  ]);
  return {
    titles: (tRes.data ?? []) as Title[],
    preps: (pRes.data ?? []) as Prep[],
  };
}

function buildRows(dom: LoadedDomain): Row[] {
  // Sumber kebenaran: gunakan helper. Bila di masa depan selector berubah
  // (mis. kolom deleted_at ikut mendefinisikan "aktif"), halaman ini
  // otomatis ikut. Itulah gunanya SSOT.
  const activeMap = countActiveByTitle(dom.preps);
  const titleById = new Map(dom.titles.map((t) => [t.id, t.name]));
  // Kumpulkan sent count via partisi (referensi array yang sama →
  // dimemoize oleh selector, murah dipanggil ulang).
  const sentByTitle = new Map<string, number>();
  for (const p of filterSentPreps(dom.preps)) {
    if (!p.title_id) continue;
    sentByTitle.set(p.title_id, (sentByTitle.get(p.title_id) ?? 0) + 1);
  }
  // Union semua title yang muncul di titles atau di preps (yatim).
  const ids = new Set<string>();
  for (const t of dom.titles) ids.add(t.id);
  for (const p of dom.preps) if (p.title_id) ids.add(p.title_id);

  const rows: Row[] = [];
  for (const id of ids) {
    const active = activeMap.get(id) ?? 0;
    const sent = sentByTitle.get(id) ?? 0;
    rows.push({
      title_id: id,
      name: titleById.get(id) ?? "(judul tidak ditemukan / dihapus)",
      active,
      sent,
      total: active + sent,
    });
  }
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return rows;
}

function DebugSelectorPage() {
  const [data, setData] = useState<{ request: LoadedDomain; ecer: LoadedDomain } | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [orphanOnly, setOrphanOnly] = useState(false);
  // Baris yang sedang menunggu re-check angka setelah aksi cepat.
  // Bentuknya `${domain}:${title_id}` supaya key unik lintas domain.
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [request, ecer] = await Promise.all([loadDomain("request"), loadDomain("ecer")]);
      setData({ request, ecer });
      setLastLoadedAt(Date.now());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Aksi cepat: flip `sold_at` untuk SATU prep di title_id tertentu.
  //
  // PENTING: aksi ini menyentuh langsung kolom `sold_at` — TIDAK memicu
  // pencatatan sales/hutang seperti alur normal `send_request_prep_to_customer`.
  // Untuk itulah tombol ini hidup di halaman debug: hanya untuk memverifikasi
  // pipeline selector → badge, bukan untuk operasional harian.
  const runQuickAction = useCallback(
    async (domain: Domain, titleId: string, action: "mark" | "cancel") => {
      const key = `${domain}:${titleId}`;
      const table =
        domain === "request" ? "request_preparations" : "ecer_preparations";
      const preps = data?.[domain].preps ?? [];
      // Pilih 1 prep target sesuai aksi via SSOT helper — jangan menulis
      // literal `!p.sold_at` di sini (dilarang oleh ESLint sold_at guard).
      const inTitle = preps.filter((p) => p.title_id === titleId);
      const target =
        action === "mark"
          ? inTitle.find((p) => isActivePrep(p))
          : inTitle.find((p) => isSentPrep(p));
      if (!target) {
        toast.error(
          action === "mark"
            ? "Tidak ada prep aktif untuk ditandai"
            : "Tidak ada prep terkirim untuk dibatalkan",
        );
        return;
      }
      setPending((s) => new Set(s).add(key));
      try {
        const { error } = await sb
          .from(table)
          .update({ sold_at: action === "mark" ? new Date().toISOString() : null })
          .eq("id", target.id);
        if (error) throw error;
        // Tunggu re-check otomatis: reload penuh supaya angka Aktif/Terkirim
        // berasal dari helper selector, bukan dari state optimistik lokal.
        await load();
        toast.success(
          action === "mark"
            ? "Ditandai terkirim — angka diperbarui"
            : "Dibatalkan — angka diperbarui",
        );
      } catch (e) {
        toast.error("Gagal: " + (e as Error).message);
      } finally {
        setPending((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
      }
    },
    [data, load],
  );

  // Auto re-check saat tab debug kembali fokus (mis. setelah user selesai
  // Tandai/Batalkan Terkirim di tab request/ecer yang dibuka via shortcut).
  // Tidak perlu tombol manual lagi — angka menyesuaikan otomatis.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const requestRows = useMemo(() => (data ? buildRows(data.request) : []), [data]);
  const ecerRows = useMemo(() => (data ? buildRows(data.ecer) : []), [data]);

  const q = query.trim().toLowerCase();
  const applyFilter = (rows: Row[]) =>
    rows.filter((r) => {
      if (orphanOnly && r.name !== "(judul tidak ditemukan / dihapus)") return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) || r.title_id.toLowerCase().includes(q)
      );
    });

  const requestFiltered = applyFilter(requestRows);
  const ecerFiltered = applyFilter(ecerRows);

  return (
    <div className="mx-auto max-w-4xl space-ms-4 p-ms-3 pb-24">
      <div className="flex items-center justify-between gap-ms-2">
        <Link
          to="/"
          className="inline-flex items-center gap-ms-1 text-ms-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Beranda
        </Link>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
          className="h-8 gap-ms-1"
        >
          <RefreshCw className={"h-3.5 w-3.5 " + (loading ? "animate-spin" : "")} />
          Muat ulang
        </Button>
      </div>

      <header className="space-y-1">
        <h1 className="text-ms-lg font-semibold">Debug Selector — Active vs Sent per title_id</h1>
        <p className="text-ms-xs text-muted-foreground">
          Sumber: <code className="rounded bg-muted px-1">countActiveByTitle</code> +{" "}
          <code className="rounded bg-muted px-1">filterSentPreps</code>. Angka di sini
          adalah patokan; kalau badge di layar lain berbeda, badge-nya yang salah.
        </p>
        <p className="text-ms-2xs text-muted-foreground">
          Tombol <span className="font-medium">Buka</span> pada tiap baris membuka halaman
          domain di tab baru dengan judul terkait sudah terfilter — pakai untuk
          Tandai/Batalkan Terkirim. Saat kembali ke tab ini, angka dimuat ulang otomatis.
        </p>
        {lastLoadedAt && (
          <p className="text-ms-2xs text-muted-foreground">
            Terakhir dimuat: {new Date(lastLoadedAt).toLocaleTimeString("id-ID")}
          </p>
        )}
      </header>

      <div className="flex flex-col gap-ms-2 rounded-md border bg-card p-ms-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama judul atau title_id…"
            className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-ms-xs"
          />
        </div>
        <label className="flex items-center gap-ms-1.5 text-ms-2xs text-muted-foreground">
          <input
            type="checkbox"
            checked={orphanOnly}
            onChange={(e) => setOrphanOnly(e.target.checked)}
          />
          Hanya prep yatim (judul terhapus)
        </label>
      </div>

      <DomainSection
        label="Request"
        domain="request"
        rows={requestFiltered}
        totalPreps={data?.request.preps.length ?? 0}
        totalActive={data ? countActivePreps(data.request.preps) : 0}
        totalSent={data ? filterActivePreps(data.request.preps).length !== data.request.preps.length
          ? data.request.preps.length - countActivePreps(data.request.preps)
          : 0 : 0}
        pending={pending}
        onQuickAction={runQuickAction}
      />

      <DomainSection
        label="Ecer"
        domain="ecer"
        rows={ecerFiltered}
        totalPreps={data?.ecer.preps.length ?? 0}
        totalActive={data ? countActivePreps(data.ecer.preps) : 0}
        totalSent={data
          ? data.ecer.preps.length - countActivePreps(data.ecer.preps)
          : 0}
        pending={pending}
        onQuickAction={runQuickAction}
      />
    </div>
  );
}

function DomainSection({
  label,
  domain,
  rows,
  totalPreps,
  totalActive,
  totalSent,
  pending,
  onQuickAction,
}: {
  label: string;
  domain: Domain;
  rows: Row[];
  totalPreps: number;
  totalActive: number;
  totalSent: number;
  pending: Set<string>;
  onQuickAction: (domain: Domain, titleId: string, action: "mark" | "cancel") => Promise<void>;
}) {
  // Shortcut: buka halaman domain terkait di tab baru dengan title terpilih
  // + highlight aktif. Setelah user Tandai/Batalkan Terkirim di sana lalu
  // kembali ke tab debug, angka otomatis di-refetch (visibilitychange).
  const domainPath = domain === "request" ? "/request" : "/ecer";
  return (
    <section className="space-ms-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-ms-sm font-semibold">{label}</h2>
        <p className="text-ms-2xs text-muted-foreground">
          {totalPreps} prep · <span className="text-emerald-600 dark:text-emerald-400">{totalActive} aktif</span> ·{" "}
          <span className="text-amber-600 dark:text-amber-400">{totalSent} terkirim</span>
        </p>
      </div>
      <p className="rounded border border-amber-500/30 bg-amber-500/5 px-ms-2 py-1 text-ms-2xs text-amber-700 dark:text-amber-300">
        Debug-only: tombol Tandai/Batalkan pada tabel ini menulis <code>sold_at</code> langsung
        pada 1 prep dari <code>title_id</code> tersebut — TIDAK mencatat penjualan/hutang.
        Gunakan hanya untuk uji konsistensi angka selector. Untuk alur nyata pakai tombol Buka.
      </p>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed bg-card p-ms-3 text-center text-ms-2xs text-muted-foreground">
          Tidak ada baris untuk ditampilkan.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border bg-card">
          <table className="w-full border-collapse text-ms-xs">
            <thead className="bg-muted/50 text-ms-2xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-ms-2 py-1.5 text-left">Judul</th>
                <th className="px-ms-2 py-1.5 text-right">Aktif</th>
                <th className="px-ms-2 py-1.5 text-right">Terkirim</th>
                <th className="px-ms-2 py-1.5 text-right">Total</th>
                <th className="px-ms-2 py-1.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = `${domain}:${r.title_id}`;
                const busy = pending.has(key);
                return (
                <tr
                  key={r.title_id}
                  className={"border-t " + (busy ? "bg-muted/40" : "")}
                  data-testid={`row-${domain}-${r.title_id}`}
                >
                  <td className="px-ms-2 py-1.5">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="truncate font-mono text-ms-2xs text-muted-foreground">
                      {r.title_id}
                    </div>
                  </td>
                  <td
                    data-testid={`cell-active-${domain}-${r.title_id}`}
                    className={"px-ms-2 py-1.5 text-right tabular-nums " + (r.active > 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}
                  >
                    {r.active}
                  </td>
                  <td
                    data-testid={`cell-sent-${domain}-${r.title_id}`}
                    className={"px-ms-2 py-1.5 text-right tabular-nums " + (r.sent > 0 ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted-foreground")}
                  >
                    {r.sent}
                  </td>
                  <td className="px-ms-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {r.total}
                  </td>
                  <td className="px-ms-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-ms-1">
                      <button
                        type="button"
                        data-testid={`debug-mark-${domain}-${r.title_id}`}
                        disabled={busy || r.active <= 0}
                        onClick={() => void onQuickAction(domain, r.title_id, "mark")}
                        className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-ms-2xs text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-40 dark:text-emerald-300"
                        title="Tandai 1 prep aktif → terkirim (debug: tanpa mencatat sales/hutang)"
                      >
                        <Check className="h-3 w-3" /> Tandai
                      </button>
                      <button
                        type="button"
                        data-testid={`debug-cancel-${domain}-${r.title_id}`}
                        disabled={busy || r.sent <= 0}
                        onClick={() => void onQuickAction(domain, r.title_id, "cancel")}
                        className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-ms-2xs text-amber-700 hover:bg-amber-500/10 disabled:opacity-40 dark:text-amber-300"
                        title="Batalkan 1 prep terkirim → aktif (debug: tidak menyentuh sales/hutang)"
                      >
                        <Undo2 className="h-3 w-3" /> Batalkan
                      </button>
                    <Link
                      to={domainPath}
                      search={{ title: r.title_id, highlight: r.title_id }}
                      target="_blank"
                      rel="noopener"
                        data-testid={`debug-open-${domain}-${r.title_id}`}
                      className="inline-flex items-center gap-ms-1 rounded border px-1.5 py-0.5 text-ms-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Buka di tab baru untuk Tandai/Batalkan Terkirim. Angka di sini otomatis dimuat ulang saat kembali."
                    >
                      Buka <ExternalLink className="h-3 w-3" />
                    </Link>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}