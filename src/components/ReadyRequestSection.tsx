import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Boxes,
  Inbox,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
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
import { displayUnit } from "@/lib/unit-label";
import { useLayoutMode, layoutGridClass, LayoutModeToggle } from "@/components/LayoutModeToggle";
import { useOnDebtTx } from "@/lib/debt-tx-event";
import { countActiveByTitle, countActivePreps, withActivePrepsFilter } from "@/lib/prep-active-selector";
import { measureQuery, QueryMetricNames } from "@/lib/query-metrics";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Row = {
  id: string;
  name: string;
  items_summary: string;
  product_count: number;
  prep_count: number;
};

export function ReadyRequestSection() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useLayoutMode("readyRequest", "list");
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Total prep (aktif + Riwayat Terkirim) untuk judul yang akan dihapus.
  // Badge kartu hanya menghitung prep aktif, padahal FK
  // request_preparations.title_id memakai ON DELETE RESTRICT — jadi prep
  // historis pun memblokir penghapusan.
  const [pendingPrepTotal, setPendingPrepTotal] = useState<number | null>(null);
  // Rincian: paket aktif (belum terkirim) vs Riwayat Terkirim, supaya dialog
  // menyebut angka tepat, bukan sekadar total gabungan.
  const [pendingBreakdown, setPendingBreakdown] = useState<{
    active: number;
    sent: number;
  } | null>(null);

  const openDelete = useCallback(async (r: Row) => {
    setPendingDelete(r);
    setPendingPrepTotal(null);
    setPendingBreakdown(null);
    const { data } = await sb
      .from("request_preparations")
      .select("id,sold_at")
      .eq("title_id", r.id);
    const preps = (data ?? []) as Array<{ sold_at: string | null }>;
    const active = countActivePreps(preps);
    setPendingBreakdown({ active, sent: preps.length - active });
    setPendingPrepTotal(preps.length);
  }, []);
  const gridClass = layoutGridClass(layout);
  const compact = layout === "compact";
  const navigate = useNavigate();

  const openSendFlow = useCallback((r: Row, channel: "wa" | "chat") => {
    if (r.prep_count === 0) {
      toast.error("Belum ada kiriman pegawai", {
        description:
          "Tidak ada paket aktif untuk judul ini. Buka /request dan buat/tunggu penyiapan dulu.",
      });
      return;
    }
    void navigate({
      to: "/request",
      search: { title: r.id, highlight: undefined, send: channel },
    });
  }, [navigate]);

  const load = useCallback(async () => {
    const [tRes, tiRes, wRes, pRes] = await Promise.all([
      sb.from("request_titles").select("id,name").order("position").order("created_at"),
      sb.from("request_title_items").select("id,title_id,warehouse_item_id,target_grams,unit_label,position").order("position"),
      supabase.from("warehouse_items").select("id,name"),
      // Badge "N paket" hanya menghitung prep AKTIF (belum Riwayat Terkirim).
      // Filter dilakukan server-side lewat helper `withActivePrepsFilter`
      // supaya logikanya identik dengan permukaan badge lain.
      measureQuery(QueryMetricNames.requestPrepAktifBadge, () =>
        withActivePrepsFilter(
          sb.from("request_preparations").select("id,title_id,sold_at"),
        ),
      ),
    ]);
    const titles = (tRes.data ?? []) as Array<{ id: string; name: string }>;
    const items = (tiRes.data ?? []) as Array<{ title_id: string; warehouse_item_id: string; target_grams: number; unit_label: string }>;
    const wis = (wRes.data ?? []) as Array<{ id: string; name: string }>;
    const preps = (pRes.data ?? []) as Array<{ title_id: string; sold_at: string | null }>;
    const wMap = new Map(wis.map((w) => [w.id, w.name]));
    // Sabuk & tali pengaman: query server sudah difilter, klien pun ikut
    // menyaring lewat helper `countActiveByTitle` supaya kalau suatu saat
    // filter server hilang, badge tetap benar.
    const activeCountByTitle = countActiveByTitle(preps);
    const out: Row[] = titles.map((t) => {
      const tItems = items.filter((i) => i.title_id === t.id);
      return {
        id: t.id,
        name: t.name,
        items_summary: tItems.map((i) => {
          const name = wMap.get(i.warehouse_item_id);
          return `${name ?? "?"} ${i.target_grams}${displayUnit(name, i.unit_label)}`;
        }).join(" · "),
        product_count: tItems.length,
        prep_count: activeCountByTitle.get(t.id) ?? 0,
      };
    });
    setRows(out);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useOnDebtTx(useCallback(() => { void load(); }, [load]));

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    if (pendingPrepTotal && pendingPrepTotal > 0) {
      toast.error("Judul tidak bisa dihapus", {
        description: `Masih terhubung ke ${pendingPrepTotal} paket penyiapan (termasuk Riwayat Terkirim). Hapus atau pindahkan paket-paket itu dulu.`,
      });
      return;
    }
    setDeleting(true);
    try {
      const { error } = await sb.from("request_titles").delete().eq("id", pendingDelete.id);
      if (error) throw error;
      toast.success("Judul request dihapus", { description: pendingDelete.name });
      setPendingDelete(null);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const isFk = /foreign key|violates|23503/i.test(msg);
      toast.error("Gagal menghapus", {
        description: isFk
          ? "Judul ini masih dipakai oleh data paket penyiapan (termasuk Riwayat Terkirim), jadi tidak bisa dihapus."
          : msg || "Coba lagi sebentar.",
      });
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, pendingPrepTotal, load]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.items_summary.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <section className="space-ms-2">
      <div className="flex items-center justify-between">
        <h2 className="text-ms-2xs uppercase tracking-wide text-muted-foreground font-normal m-0">
          Paket Request Siap Kirim
        </h2>
        <div className="flex items-center gap-ms-2">
          {/* Setelan tata letak tampil juga di mobile, sama seperti bagian
              "Siapkan Sendiri — Siap Dikirim". */}
          <div className="inline-flex">
            <LayoutModeToggle mode={layout} onChange={setLayout} />
          </div>
          <Link to="/request" search={{ title: undefined, highlight: undefined, send: undefined }} className="text-ms-2xs font-medium text-primary hover:underline">Kelola →</Link>
        </div>
      </div>

      {rows && rows.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari judul / produk…"
            className="h-8 w-full rounded-md border bg-card pl-7 pr-7 text-ms-xs"
          />
          {query && (
            <button type="button" aria-label="Hapus pencarian" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
      )}

      {rows === null ? (
        <div className={gridClass} aria-busy="true" aria-label="Memuat paket request">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-ms-1.5 rounded-md border bg-card p-ms-2.5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-4 w-12 rounded" />
              </div>
              <Skeleton className="h-2.5 w-4/5" />
              <Skeleton className="h-2.5 w-3/5" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Link
          to="/request"
          search={{ title: undefined, highlight: undefined, send: undefined }}
          className="flex flex-col items-center gap-ms-1.5 rounded-md border border-dashed bg-card p-ms-5 text-center text-ms-xs text-muted-foreground hover:border-primary/40 hover:bg-accent"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <PackagePlus className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium text-foreground">Belum ada judul request</span>
          <span>Tap untuk membuat paket request pertama.</span>
        </Link>
      ) : filtered && filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-ms-1 rounded-md border border-dashed bg-card p-ms-4 text-center text-ms-xs text-muted-foreground">
          <Search className="h-4 w-4 opacity-60" />
          <span>Tidak ada hasil untuk pencarian itu.</span>
        </div>
      ) : (
        <div className={gridClass}>
          {(filtered ?? []).map((r) => (
            <RequestCard
              key={r.id}
              row={r}
              compact={compact}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              onSendWa={() => openSendFlow(r, "wa")}
              onDelete={() => { void openDelete(r); }}
            />
          ))}
        </div>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => { if (!o && !deleting) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus judul request?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.name}
              {pendingPrepTotal === null
                ? " — memeriksa data paket terkait…"
                : pendingPrepTotal > 0
                  ? ` — judul ini masih terhubung ke ${pendingPrepTotal} paket penyiapan (termasuk Riwayat Terkirim), jadi belum bisa dihapus. Hapus paket-paket itu dulu.`
                  : " — daftar produk pada judul ini ikut terhapus."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || pendingPrepTotal === null || pendingPrepTotal > 0}
              onClick={(e) => { e.preventDefault(); void confirmDelete(); }}
            >
              {deleting ? "Menghapus…" : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function RequestCard({
  row: r,
  compact,
  refreshing,
  onRefresh,
  onSendWa,
  onDelete,
}: {
  row: Row;
  compact: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onSendWa: () => void;
  onDelete: () => void;
}) {
  const hasPrep = r.prep_count > 0;
  return (
    <div
      data-testid={`ready-request-card-${r.id}`}
      className={
        "flex flex-col gap-ms-1.5 rounded-md border bg-card " +
        (compact ? "px-ms-2.5 py-1.5" : "p-ms-2.5")
      }
    >
      <Link
        to="/request"
        search={{ title: undefined, highlight: r.id, send: undefined }}
        aria-label={`Buka detail ${r.name} di halaman Request`}
        className="flex flex-col gap-0.5 hover:opacity-90"
      >
        <div className="flex min-w-0 items-center gap-ms-1.5">
          <Boxes className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span
            className="min-w-0 flex-1 truncate text-ms-xs font-semibold leading-snug"
            title={r.name}
          >
            {r.name}
          </span>
          <span
            data-testid={`ready-request-badge-${r.id}`}
            data-badge-count={r.prep_count}
            className={
              "shrink-0 rounded px-1.5 py-0.5 text-ms-2xs font-medium " +
              (hasPrep
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground")
            }
          >
            {r.prep_count} paket
          </span>
        </div>
        {!compact && (
          <span
            className="block min-w-0 truncate text-ms-2xs font-medium leading-none text-foreground/80"
            title={r.items_summary || `${r.product_count} produk`}
          >
            {r.items_summary || `${r.product_count} produk`}
          </span>
        )}
        {!compact && hasPrep && (
          <span className="mt-0.5 text-ms-2xs font-semibold leading-snug text-success dark:text-success">
            {r.prep_count} paket siap dikirim
          </span>
        )}
      </Link>

      {/* Satu aksi utama.
          - Ada paket → "Kirim ke pembeli" (lewat verifikasi bayar di /request?send=wa)
          - Belum ada → "Buka tugas" + link kecil "Segarkan" (tidak lagi panel besar)
          Alur verifikasi & tes `send=wa` tetap sama; hanya dua tombol WA/Chat
          yang digabung. Pilihan Chat tetap tersedia di dialog /request. */}
      {hasPrep ? (
        <div className="flex items-center gap-ms-1.5">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSendWa(); }}
            aria-label={`Kirim ${r.prep_count} paket ke pembeli untuk ${r.name}`}
            title="Verifikasi bayar dulu → kirim ke pembeli"
            className="inline-flex h-8 flex-1 items-center justify-center gap-ms-1 rounded-md bg-wa px-ms-2 text-ms-2xs font-semibold text-wa-foreground shadow-sm transition hover:bg-wa/90"
          >
            <Send className="h-3 w-3" /> Kirim ke pembeli
          </button>
          <DeleteButton name={r.name} onDelete={onDelete} />
        </div>
      ) : (
        <div className="flex items-center gap-ms-1.5">
          <Link
            to="/request"
            search={{ title: r.id, highlight: undefined, send: undefined }}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Buka tugas pegawai untuk ${r.name}`}
            className="inline-flex h-8 flex-1 items-center justify-center gap-ms-1 rounded-md border border-dashed border-primary/50 bg-primary/5 px-ms-2 text-ms-2xs font-semibold text-primary hover:bg-primary/10"
          >
            {refreshing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Inbox className="h-3 w-3" />
            )}
            {refreshing ? "Memuat…" : "Menunggu foto pegawai"}
          </Link>
          <button
            type="button"
            aria-label={`Segarkan kiriman pegawai untuk ${r.name}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRefresh(); }}
            disabled={refreshing}
            title="Segarkan"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <DeleteButton name={r.name} onDelete={onDelete} />
        </div>
      )}
    </div>
  );
}

function DeleteButton({ name, onDelete }: { name: string; onDelete: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Hapus judul request ${name}`}
      title="Hapus"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
    >
      <Trash2 className="h-3 w-3" />
    </button>
  );
}