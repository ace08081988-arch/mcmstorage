/**
 * Pemilih "Barang sudah jadi" untuk tab Jual di Gudang.
 *
 * Sumber data: `ecer_preparations` yang sudah disiapkan pegawai/owner dan
 * BELUM terjual (`sold_at IS NULL`). Memilih salah satu paket akan mengunci
 * barang + jumlah pada form Jual, sehingga penjualan paket jadi memakai
 * jalur `sales` yang sama (stok berkurang otomatis, hutang/piutang ikut
 * tercatat) — bukan data terpisah yang tidak sinkron.
 */
import { useCallback, useEffect, useState } from "react";
import { PackageCheck, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { withActivePrepsFilter } from "@/lib/prep-active-selector";

export type ReadyPrep = {
  id: string;
  warehouseItemId: string | null;
  grams: number;
  titleName: string;
  createdAt: string;
};

type PrepRow = {
  id: string;
  title_id: string | null;
  warehouse_item_id: string | null;
  actual_grams: number | string | null;
  created_at: string;
};

export async function fetchReadyPreps(): Promise<ReadyPrep[]> {
  const { data, error } = await withActivePrepsFilter(
    supabase
      .from("ecer_preparations")
      .select("id, title_id, warehouse_item_id, actual_grams, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  );
  if (error || !data) return [];
  const rows = data as unknown as PrepRow[];
  const titleIds = Array.from(
    new Set(rows.map((r) => r.title_id).filter((v): v is string => !!v)),
  );
  const names = new Map<string, string>();
  if (titleIds.length > 0) {
    const { data: titles } = await supabase
      .from("ecer_titles")
      .select("id, name")
      .in("id", titleIds);
    for (const t of (titles ?? []) as Array<{ id: string; name: string }>) {
      names.set(t.id, t.name);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    warehouseItemId: r.warehouse_item_id,
    grams: Number(r.actual_grams) || 0,
    titleName: (r.title_id && names.get(r.title_id)) || "Paket siap",
    createdAt: r.created_at,
  }));
}

export function ReadyPrepPicker({
  selectedId,
  onPick,
  onClear,
  itemNameById,
}: {
  selectedId: string | null;
  onPick: (prep: ReadyPrep) => void;
  onClear: () => void;
  itemNameById: (id: string | null) => string | null;
}) {
  const [preps, setPreps] = useState<ReadyPrep[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPreps(await fetchReadyPreps());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = preps.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-ms-2">
      <div className="flex items-center gap-ms-2">
        <PackageCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
        <span className="flex-1 text-[0.6875rem] font-semibold">
          Barang sudah jadi (paket siap)
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded border px-1.5 py-0.5 text-[0.625rem] hover:bg-muted disabled:opacity-50"
          aria-label="Muat ulang paket siap"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {selected ? (
        <div className="mt-1.5 flex items-center gap-ms-2 rounded border bg-background px-ms-2 py-1.5 text-ms-xs">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{selected.titleName}</div>
            <div className="text-[0.625rem] text-muted-foreground">
              {selected.grams} g · {itemNameById(selected.warehouseItemId) ?? "barang tidak dikenal"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="rounded border px-1.5 py-0.5 text-[0.625rem] hover:bg-muted"
          >
            <X className="mr-0.5 inline h-3 w-3" />
            Lepas
          </button>
        </div>
      ) : loading ? (
        <div className="mt-1.5 text-[0.625rem] text-muted-foreground">Memuat paket siap…</div>
      ) : preps.length === 0 ? (
        <div className="mt-1.5 text-[0.625rem] text-muted-foreground">
          Belum ada paket siap yang belum terjual. Isi lewat penyiapan pegawai / Ecer.
        </div>
      ) : (
        <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
          {preps.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="flex w-full items-center gap-ms-2 rounded border bg-background px-ms-2 py-1.5 text-left text-ms-xs hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate">{p.titleName}</span>
                <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                  {p.grams} g · {itemNameById(p.warehouseItemId) ?? "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}