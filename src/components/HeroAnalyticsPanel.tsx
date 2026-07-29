/**
 * Panel analitik hero di Beranda.
 *
 * Menampilkan metrik kunci hari ini (omzet, transaksi, unit terjual, produk
 * terlaris) langsung dari tabel `sales` (SSOT penjualan) dengan pembaruan
 * realtime — tanpa menyimpan salinan angka di tempat lain.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

type SaleRow = {
  id: string;
  item_id: string;
  qty_base: number;
  total_revenue: number;
  created_at: string;
  warehouse_items?: { name: string; base_unit: string | null } | null;
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const rupiah = (n: number) =>
  `Rp ${Math.round(n).toLocaleString("id-ID")}`;

function useTodaySales() {
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const nameCache = useRef(new Map<string, { name: string; base_unit: string | null }>());

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    supabase
      .from("sales")
      .select("id,item_id,qty_base,total_revenue,created_at,warehouse_items(name,base_unit)")
      .gte("created_at", startOfToday().toISOString())
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return;
        if (!error && data) {
          const list = data as unknown as SaleRow[];
          for (const r of list) {
            if (r.warehouse_items) nameCache.current.set(r.item_id, r.warehouse_items);
          }
          setRows(list);
          setLastSyncAt(Date.now());
        }
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  useEffect(() => {
    const channel = supabase
      .channel("hero-analytics-sales")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, (payload) => {
        const rowNew = payload.new as Partial<SaleRow> | null;
        const rowOld = payload.old as { id?: string } | null;
        setLastSyncAt(Date.now());
        setRows((prev) => {
          if (payload.eventType === "DELETE") {
            return rowOld?.id ? prev.filter((r) => r.id !== rowOld.id) : prev;
          }
          if (!rowNew?.id || !rowNew.created_at) return prev;
          if (new Date(rowNew.created_at) < startOfToday()) return prev;
          const enriched = {
            ...(rowNew as SaleRow),
            warehouse_items:
              rowNew.warehouse_items ?? nameCache.current.get(rowNew.item_id ?? "") ?? null,
          } as SaleRow;
          const idx = prev.findIndex((r) => r.id === enriched.id);
          if (idx === -1) return [enriched, ...prev];
          const next = prev.slice();
          next[idx] = { ...next[idx], ...enriched };
          return next;
        });
      })
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { rows, loading, connected, lastSyncAt, refresh };
}

function Metric({
  label,
  value,
  hint,
  to,
  linkLabel,
}: {
  label: string;
  value: string;
  hint?: string;
  to?: string;
  linkLabel?: string;
}) {
  const body = (
    <>
      <p className="text-ms-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-ms-lg font-semibold tabular-nums" title={value}>
        {value}
      </p>
      {hint ? <p className="truncate text-ms-2xs text-muted-foreground">{hint}</p> : null}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        aria-label={linkLabel ?? `Lihat detail ${label}`}
        className="block rounded-xl border border-border/60 bg-background/60 p-ms-2.5 transition-colors hover:border-primary/50 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-ms-2.5">
      {body}
    </div>
  );
}

export function HeroAnalyticsPanel() {
  const { rows, loading, connected, lastSyncAt, refresh } = useTodaySales();

  const stats = useMemo(() => {
    let omzet = 0;
    let unit = 0;
    const byItem = new Map<string, { name: string; qty: number; revenue: number; unitLabel: string }>();
    for (const r of rows) {
      const qty = Number(r.qty_base) || 0;
      const rev = Number(r.total_revenue) || 0;
      omzet += rev;
      unit += qty;
      const key = r.item_id;
      const cur = byItem.get(key) ?? {
        name: r.warehouse_items?.name ?? "Produk",
        qty: 0,
        revenue: 0,
        unitLabel: r.warehouse_items?.base_unit || "pcs",
      };
      cur.qty += qty;
      cur.revenue += rev;
      byItem.set(key, cur);
    }
    const best = [...byItem.values()].sort((a, b) => b.qty - a.qty)[0] ?? null;
    return { omzet, unit, trx: rows.length, best };
  }, [rows]);

  return (
    <section
      aria-label="Ringkasan penjualan hari ini"
      className="rounded-2xl border border-border/60 bg-card/70 p-ms-3 shadow-sm"
    >
      <div className="mb-ms-2 flex items-center justify-between gap-ms-2">
        <div className="min-w-0">
          <h2 className="truncate text-ms-base font-semibold">Ringkasan hari ini</h2>
          <p className="truncate text-ms-2xs text-muted-foreground">
            Sumber: penjualan (SSOT) ·{" "}
            {lastSyncAt ? `diperbarui ${new Date(lastSyncAt).toLocaleTimeString("id-ID")}` : "memuat…"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-ms-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-ms-2xs ${
              connected ? "border-primary/40 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                connected ? "animate-pulse bg-primary" : "bg-muted-foreground/50"
              }`}
            />
            {connected ? "Live" : "Offline"}
          </span>
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border px-2 py-0.5 text-ms-2xs text-muted-foreground hover:bg-muted"
            aria-label="Muat ulang ringkasan"
          >
            ⟲
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-ms-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-ms-2 sm:grid-cols-4">
          <Metric label="Omzet hari ini" value={rupiah(stats.omzet)} />
          <Metric
            label="Transaksi"
            value={stats.trx.toLocaleString("id-ID")}
            hint="penjualan tercatat · lihat detail"
            to="/transaksi-hari-ini"
            linkLabel="Lihat detail transaksi hari ini"
          />
          <Metric
            label="Unit terjual"
            value={stats.unit.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
            hint="lihat transaksi penyumbang"
            to="/transaksi-hari-ini"
            linkLabel="Lihat transaksi yang menyumbang unit terjual"
          />
          <Metric
            label="Terlaris"
            value={stats.best?.name ?? "—"}
            hint={
              stats.best
                ? `${stats.best.qty.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${stats.best.unitLabel} · ${rupiah(stats.best.revenue)}`
                : "belum ada penjualan"
            }
          />
        </div>
      )}
    </section>
  );
}
