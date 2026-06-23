import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PackagePlus, Search, X } from "lucide-react";

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
  const [query, setQuery] = useState("");

  useEffect(() => {
    void (async () => {
      const [tRes, tiRes, wRes, pRes] = await Promise.all([
        sb.from("request_titles").select("id,name").order("position").order("created_at"),
        sb.from("request_title_items").select("id,title_id,warehouse_item_id,target_grams,unit_label,position").order("position"),
        supabase.from("warehouse_items").select("id,name"),
        sb.from("request_preparations").select("id,title_id"),
      ]);
      const titles = (tRes.data ?? []) as Array<{ id: string; name: string }>;
      const items = (tiRes.data ?? []) as Array<{ title_id: string; warehouse_item_id: string; target_grams: number; unit_label: string }>;
      const wis = (wRes.data ?? []) as Array<{ id: string; name: string }>;
      const preps = (pRes.data ?? []) as Array<{ title_id: string }>;
      const wMap = new Map(wis.map((w) => [w.id, w.name]));
      const out: Row[] = titles.map((t) => {
        const tItems = items.filter((i) => i.title_id === t.id);
        return {
          id: t.id,
          name: t.name,
          items_summary: tItems.map((i) => `${wMap.get(i.warehouse_item_id) ?? "?"} ${i.target_grams}${i.unit_label}`).join(" · "),
          product_count: tItems.length,
          prep_count: preps.filter((p) => p.title_id === t.id).length,
        };
      });
      setRows(out);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.items_summary.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Paket Request Siap Kirim
        </p>
        <Link to="/request" search={{ title: undefined, highlight: undefined }} className="text-[11px] font-medium text-primary hover:underline">Kelola →</Link>
      </div>

      {rows && rows.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari judul / produk…"
            className="h-8 w-full rounded-md border bg-card pl-7 pr-7 text-xs"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
      )}

      {rows === null ? (
        <div className="rounded-md border bg-card p-4 text-center text-xs text-muted-foreground">Memuat…</div>
      ) : rows.length === 0 ? (
        <Link to="/request" search={{ title: undefined, highlight: undefined }} className="flex items-center justify-center gap-2 rounded-md border border-dashed bg-card p-4 text-xs text-muted-foreground hover:border-primary/40">
          <PackagePlus className="h-4 w-4" /> Belum ada judul request. Klik untuk buat.
        </Link>
      ) : filtered && filtered.length === 0 ? (
        <div className="rounded-md border bg-card p-3 text-center text-xs text-muted-foreground">Tidak ada hasil.</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(filtered ?? []).map((r) => (
            <Link
              key={r.id}
              to="/request"
              search={{ title: undefined, highlight: r.id }}
              className="flex flex-col gap-0.5 rounded-md border bg-card p-2.5 hover:border-primary/40 hover:bg-accent"
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-xs font-semibold">{r.name}</span>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {r.prep_count} paket
                </span>
              </div>
              <span className="line-clamp-2 text-[10px] text-muted-foreground">
                {r.items_summary || `${r.product_count} produk`}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}