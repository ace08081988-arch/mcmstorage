import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Boxes,
  Inbox,
  Loader2,
  MessageCircle,
  PackagePlus,
  RefreshCw,
  Search,
  Send,
  X,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { displayUnit } from "@/lib/unit-label";
import { useLayoutMode, layoutGridClass, LayoutModeToggle } from "@/components/LayoutModeToggle";
import { useOnDebtTx } from "@/lib/debt-tx-event";
import { countActiveByTitle, withActivePrepsFilter } from "@/lib/prep-active-selector";
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
          {/* Layout toggle desktop-only — mobile default ke list. */}
          <div className="hidden sm:inline-flex">
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
              onSendChat={() => openSendFlow(r, "chat")}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RequestCard({
  row: r,
  compact,
  refreshing,
  onRefresh,
  onSendWa,
  onSendChat,
}: {
  row: Row;
  compact: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onSendWa: () => void;
  onSendChat: () => void;
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
        {!compact && (
          <div className="mt-0.5 flex flex-wrap items-center gap-ms-1">
            <span className="inline-flex items-center gap-ms-1 rounded-full bg-muted px-1.5 py-0.5 text-ms-2xs font-medium leading-none text-muted-foreground">
              <span className="h-1 w-1 rounded-full bg-muted-foreground/60" />
              {hasPrep ? "Ada data" : "Belum ada data"}
            </span>
            <span className="inline-flex items-center gap-ms-1 rounded-full bg-muted px-1.5 py-0.5 text-ms-2xs font-medium leading-none text-muted-foreground">
              <span className="h-1 w-1 rounded-full bg-muted-foreground/60" />
              Belum dikirim
            </span>
            <span
              className="inline-flex items-center gap-ms-1 rounded-full bg-muted px-1.5 py-0.5 text-ms-2xs font-medium leading-none text-muted-foreground"
              title={`Cocok: ${r.product_count} produk paket`}
            >
              <span className="h-1 w-1 rounded-full bg-primary" />
              <span className="truncate">Cocok: {r.product_count} produk paket</span>
            </span>
          </div>
        )}
        {!compact && (
          <span className="mt-0.5 text-ms-2xs leading-snug">
            <span
              className={
                hasPrep
                  ? "font-semibold text-success dark:text-success"
                  : "text-muted-foreground"
              }
            >
              {r.prep_count} paket siap
            </span>
          </span>
        )}
      </Link>

      {/* Tombol Kirim WA/Chat — WAJIB lewat dialog verifikasi penjualan
          (mirror SiapkanSendiri/ecer): keduanya membuka
          `SendPrepToCustomerDialog` di `/request` via deep-link `send=1`. */}
      <div className="flex items-center gap-ms-1.5">
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSendWa(); }}
          disabled={!hasPrep}
          aria-label={`Kirim WA untuk ${r.name}`}
          title={
            hasPrep
              ? "Verifikasi penjualan dulu → lampirkan foto & kirim ke WhatsApp"
              : "Belum ada paket aktif — buka Request untuk membuat penyiapan"
          }
          className="inline-flex h-7 flex-1 items-center justify-center gap-ms-1 rounded-md border border-[#25D366]/40 bg-[#25D366]/15 px-ms-2 text-ms-2xs font-semibold text-[#0b6b3a] hover:bg-[#25D366]/25 disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#7ee2a8]"
        >
          <Send className="h-3 w-3" /> WA
        </button>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSendChat(); }}
          disabled={!hasPrep}
          aria-label={`Kirim Chat untuk ${r.name}`}
          title={
            hasPrep
              ? "Verifikasi penjualan dulu → lampirkan foto & kirim ke MCM Chat"
              : "Belum ada paket aktif — buka Request untuk membuat penyiapan"
          }
          className="inline-flex h-7 flex-1 items-center justify-center gap-ms-1 rounded-md border border-primary/40 bg-primary/10 px-ms-2 text-ms-2xs font-semibold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <MessageCircle className="h-3 w-3" /> Chat
        </button>
      </div>

      {!compact && !hasPrep && (
        <div className="flex flex-col items-center gap-ms-1 rounded-md border border-dashed bg-muted/40 px-ms-2 py-ms-2.5 text-center">
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          ) : (
            <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-ms-2xs font-medium leading-snug text-muted-foreground">
            {refreshing ? "Memuat kiriman…" : "Belum ada kiriman pegawai"}
          </span>
          <span className="text-ms-2xs leading-snug text-muted-foreground">
            Menunggu foto pegawai — akan muncul otomatis.
          </span>
          <button
            type="button"
            aria-label={`Segarkan kiriman pegawai untuk ${r.name}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRefresh();
            }}
            disabled={refreshing}
            className="mt-0.5 inline-flex h-6 items-center gap-ms-1 rounded bg-primary/10 px-ms-2 text-ms-2xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-2.5 w-2.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Menyegarkan…" : "Segarkan"}
          </button>
        </div>
      )}
    </div>
  );
}