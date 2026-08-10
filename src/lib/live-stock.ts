/**
 * SSOT stok produk realtime (warehouse_items).
 *
 * Satu sumber untuk Beranda (galeri produk) dan Gudang: fetch awal +
 * langganan Realtime Postgres changes. Perubahan stok dari halaman
 * manapun (POS Kasir, Kios, Gudang, portal pegawai) langsung tercermin
 * tanpa reload.
 *
 * Catatan: RLS tetap berlaku pada stream Realtime, jadi hanya baris
 * milik user yang diterima.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LiveStockItem = {
  id: string;
  name: string;
  category: string | null;
  package_type: string;
  package_size: number;
  base_unit: string;
  stock_base: number;
  avg_cost_per_base: number;
  selling_price_per_base: number | null;
  image_path: string | null;
  updated_at?: string | null;
};

export type LiveStockState = {
  items: LiveStockItem[];
  loading: boolean;
  /** Waktu terakhir data berubah (fetch atau event realtime). */
  lastSyncAt: number | null;
  connected: boolean;
  refresh: () => void;
};

function sortByName(rows: LiveStockItem[]) {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, "id-ID"));
}

/**
 * Terapkan satu event realtime ke daftar lokal (patch, bukan refetch)
 * supaya perubahan stok terasa instan.
 */
export function applyStockEvent(
  prev: LiveStockItem[],
  evt: { eventType: string; new?: Partial<LiveStockItem> | null; old?: Partial<LiveStockItem> | null },
): LiveStockItem[] {
  const row = (evt.new ?? null) as LiveStockItem | null;
  const oldId = (evt.old as { id?: string } | null)?.id;
  if (evt.eventType === "DELETE") {
    if (!oldId) return prev;
    return prev.filter((i) => i.id !== oldId);
  }
  if (!row?.id) return prev;
  const idx = prev.findIndex((i) => i.id === row.id);
  if (idx === -1) return sortByName([...prev, row]);
  const next = prev.slice();
  next[idx] = { ...next[idx], ...row };
  return next;
}

export function useLiveStock(enabled = true): LiveStockState {
  const [items, setItems] = useState<LiveStockItem[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    supabase
      .from("warehouse_items")
      .select("id,name,category,package_type,package_size,base_unit,stock_base,avg_cost_per_base,selling_price_per_base,image_path,updated_at")
      .order("name")
      .then(({ data, error }) => {
        if (!alive) return;
        if (!error && data) {
          setItems(data as LiveStockItem[]);
          setLastSyncAt(Date.now());
        }
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [enabled, tick]);

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel("live-stock-warehouse-items")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "warehouse_items" },
        (payload) => {
          setItems((prev) =>
            applyStockEvent(prev, {
              eventType: payload.eventType,
              new: payload.new as Partial<LiveStockItem> | null,
              old: payload.old as Partial<LiveStockItem> | null,
            }),
          );
          setLastSyncAt(Date.now());
        },
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled]);

  return { items, loading, lastSyncAt, connected, refresh: () => setTick((t) => t + 1) };
}

/**
 * Langganan ringan untuk halaman yang sudah punya state sendiri
 * (mis. Gudang): cukup beri tahu bahwa ada perubahan stok.
 */
export function subscribeStockChanges(
  onChange: (evt: {
    eventType: string;
    new?: Partial<LiveStockItem> | null;
    old?: Partial<LiveStockItem> | null;
  }) => void,
) {
  const channel = supabase
    .channel(`stock-changes-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "warehouse_items" }, (payload) => {
      onChange({
        eventType: payload.eventType,
        new: payload.new as Partial<LiveStockItem> | null,
        old: payload.old as Partial<LiveStockItem> | null,
      });
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
