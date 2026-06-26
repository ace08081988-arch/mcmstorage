import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Scale, Plus, ChevronRight, Search, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type Row = {
  id: string;
  name: string;
  target_grams: number;
  unit_label: string;
  warehouse_item_id: string;
  prep_count: number;
  product_name: string;
};

export function ReadyEcerSection() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState("");
  const [productFilter, setProductFilter] = useState<string>("all");

  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data: titles } = await sb
        .from("ecer_titles")
        .select("id,name,target_grams,unit_label,warehouse_item_id")
        .order("created_at", { ascending: false })
        .limit(20);
      const list = (titles ?? []) as Array<{ id: string; name: string; target_grams: number; unit_label: string; warehouse_item_id: string }>;
      if (list.length === 0) { setRows([]); return; }
      const itemIds = Array.from(new Set(list.map((t) => t.warehouse_item_id)));
      const titleIds = list.map((t) => t.id);
      const [{ data: items }, { data: preps }] = await Promise.all([
        sb.from("warehouse_items").select("id,name").in("id", itemIds),
        sb.from("ecer_preparations").select("title_id").in("title_id", titleIds),
      ]);
      const itemMap = new Map<string, string>(((items ?? []) as Array<{ id: string; name: string }>).map((i) => [i.id, i.name]));
      const countMap = new Map<string, number>();
      for (const p of ((preps ?? []) as Array<{ title_id: string }>)) {
        countMap.set(p.title_id, (countMap.get(p.title_id) ?? 0) + 1);
      }
      setRows(list.map((t) => ({
        ...t,
        prep_count: countMap.get(t.id) ?? 0,
        product_name: itemMap.get(t.warehouse_item_id) ?? "—",
      })));
    })();
  }, []);

  const q = query.trim().toLowerCase();
  const products = rows === null
    ? []
    : Array.from(
        new Map(rows.map((r) => [r.warehouse_item_id, r.product_name])).entries()
      ).sort((a, b) => a[1].localeCompare(b[1]));
  const filtered = rows === null ? null : rows.filter((r) => {
    if (productFilter !== "all" && r.warehouse_item_id !== productFilter) return false;
    if (q === "") return true;
    return r.name.toLowerCase().includes(q) || r.product_name.toLowerCase().includes(q);
  });
  const activeFilters = (q !== "" ? 1 : 0) + (productFilter !== "all" ? 1 : 0);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Produk Eceran Siap Kirim
        </p>
        <Link to="/ecer" search={{ item: undefined, title: undefined, highlight: undefined }} className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline">
          Buka semua <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {rows && rows.length > 0 && (
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari judul ecer…"
              className="h-8 w-full rounded-md border bg-card pl-7 pr-7 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/40"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent"
                aria-label="Hapus pencarian"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="h-8 max-w-[40%] rounded-md border bg-card px-2 text-xs outline-none focus:border-primary/40"
            aria-label="Filter produk"
          >
            <option value="all">Semua produk</option>
            {products.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
      )}

      {rows === null ? (
        <div className="grid grid-cols-2 gap-2" aria-busy="true" aria-label="Memuat produk eceran">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1 rounded-md border bg-card px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-3.5 w-3.5 rounded" />
                <Skeleton className="h-3 w-2/3" />
              </div>
              <Skeleton className="h-2.5 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Link
          to="/ecer"
          search={{ item: undefined, title: undefined, highlight: undefined }}
          className="flex flex-col items-center gap-1.5 rounded-md border border-dashed bg-card/50 p-5 text-center text-[11px] text-muted-foreground hover:border-primary/40 hover:bg-accent"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <Scale className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium text-foreground">Belum ada Judul Ecer</span>
          <span>Tap untuk membuat yang pertama.</span>
          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
            <Plus className="h-3 w-3" /> Buat sekarang
          </span>
        </Link>
      ) : filtered && filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-card/50 p-4 text-center text-[11px] text-muted-foreground">
          <span>Tidak ada hasil yang cocok.</span>
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => { setQuery(""); setProductFilter("all"); }}
              className="text-primary hover:underline"
            >
              Bersihkan filter
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(filtered ?? []).map((r) => (
            <Link
              key={r.id}
              to="/ecer"
              search={{ item: r.warehouse_item_id, title: r.id, highlight: undefined }}
              className="group flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2.5 text-left hover:border-primary/40 hover:bg-accent"
            >
              <div className="flex items-center gap-1.5">
                <Scale className="h-3.5 w-3.5 text-primary" />
                <span className="truncate text-xs font-semibold leading-tight">{r.name}</span>
              </div>
              <span className="truncate text-[10px] leading-tight text-muted-foreground">
                {r.product_name} · {r.target_grams} {r.product_name.trim().toLowerCase() === "gs" ? "botol" : r.unit_label}
              </span>
              <span className="text-[10px] leading-tight">
                <span className={r.prep_count > 0 ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                  {r.prep_count} kotak siap
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}