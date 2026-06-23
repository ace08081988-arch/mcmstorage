import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Scale, Plus, ChevronRight, Search, X, Edit3, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { countMatchingSelfPreps } from "@/lib/ecer-ready-count";

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
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
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
      const [{ data: items }, { data: preps }, { data: selfs }] = await Promise.all([
        sb.from("warehouse_items").select("id,name").in("id", itemIds),
        sb.from("ecer_preparations").select("title_id").in("title_id", titleIds),
        sb.from("self_prep_items").select("title"),
      ]);
      const itemMap = new Map<string, string>(((items ?? []) as Array<{ id: string; name: string }>).map((i) => [i.id, i.name]));
      const countMap = new Map<string, number>();
      for (const p of ((preps ?? []) as Array<{ title_id: string }>)) {
        countMap.set(p.title_id, (countMap.get(p.title_id) ?? 0) + 1);
      }
      const selfTitles = ((selfs ?? []) as Array<{ title: string | null }>).map((s) => s.title);
      setRows(list.map((t) => {
        const product = itemMap.get(t.warehouse_item_id) ?? "—";
        const selfCount = countMatchingSelfPreps(t.name, product, selfTitles, t.target_grams, t.unit_label);
        return {
          ...t,
          prep_count: (countMap.get(t.id) ?? 0) + selfCount,
          product_name: product,
        };
      }));
  }

  useEffect(() => { void load(); }, []);

  async function onDelete(r: Row) {
    const ok = typeof window !== "undefined" && window.confirm(
      `Hapus judul ecer "${r.name}"? Semua kotak penyiapan di judul ini juga akan dihapus dan stok yang sudah dikurangi sebelumnya akan dikembalikan.`,
    );
    if (!ok) return;
    setBusyId(r.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("ecer_titles").delete().eq("id", r.id);
    setBusyId(null);
    if (error) { toast.error("Gagal: " + error.message); return; }
    toast.success("Judul dihapus");
    setRows((prev) => (prev ?? []).filter((x) => x.id !== r.id));
  }

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
        <Link to="/ecer" className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline">
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
        <div className="rounded-md border bg-card p-4 text-center text-[11px] text-muted-foreground">Memuat…</div>
      ) : rows.length === 0 ? (
        <Link
          to="/ecer"
          className="flex items-center gap-2 rounded-md border border-dashed bg-card/50 p-4 text-[11px] text-muted-foreground hover:border-primary/40 hover:bg-accent"
        >
          <Scale className="h-4 w-4 text-primary" />
          <span className="flex-1">Belum ada Judul Ecer. Tap untuk membuat yang pertama.</span>
          <Plus className="h-4 w-4" />
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
            <div
              key={r.id}
              className="group relative flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2.5 text-left hover:border-primary/40 hover:bg-accent"
            >
              <Link
                to="/ecer"
                search={{ item: r.warehouse_item_id, title: r.id }}
                className="flex flex-col gap-0.5 pr-12"
              >
                <div className="flex items-center gap-1.5">
                  <Scale className="h-3.5 w-3.5 text-primary" />
                  <span className="truncate text-xs font-semibold leading-tight">{r.name}</span>
                </div>
                <span className="truncate text-[10px] leading-tight text-muted-foreground">
                  {r.product_name} · {r.target_grams} {r.unit_label}
                </span>
                <span className="text-[10px] leading-tight">
                  <span className={r.prep_count > 0 ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                    {r.prep_count} kotak siap
                  </span>
                </span>
              </Link>
              <div className="absolute right-1 top-1 flex gap-0.5">
                <Link
                  to="/ecer"
                  search={{ item: r.warehouse_item_id, title: r.id, edit: "1" }}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Edit ${r.name}`}
                  title="Edit judul"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={() => void onDelete(r)}
                  disabled={busyId === r.id}
                  className="rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  aria-label={`Hapus ${r.name}`}
                  title="Hapus judul"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}