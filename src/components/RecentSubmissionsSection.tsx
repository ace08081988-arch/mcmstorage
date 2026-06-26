import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { signedUrl } from "@/lib/prep";
import { Inbox, MapPin } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type Row = {
  id: string;
  task_id: string;
  task_item_id: string;
  photo_path: string | null;
  location_url: string | null;
  submitted_at: string;
  task_title: string;
  item_name: string;
  qty_reported: number | null;
  unit_label: string | null;
};

export function RecentSubmissionsSection() {
  const [rows, setRows] = useState<Row[] | null>(null);

  async function load() {
    const { data: subs } = await supabase
      .from("prep_submissions")
      .select("id,task_id,task_item_id,photo_path,location_url,submitted_at,qty_reported")
      .order("submitted_at", { ascending: false })
      .limit(8);
    const list = (subs ?? []) as Array<Omit<Row, "task_title" | "item_name" | "unit_label">>;
    if (list.length === 0) { setRows([]); return; }
    const taskIds = Array.from(new Set(list.map((s) => s.task_id)));
    const itemIds = Array.from(new Set(list.map((s) => s.task_item_id)));
    const [{ data: tasks }, { data: items }] = await Promise.all([
      supabase.from("prep_tasks").select("id,title").in("id", taskIds),
      supabase.from("prep_task_items").select("id,name_snapshot,unit_label").in("id", itemIds),
    ]);
    const tMap = new Map((tasks ?? []).map((t) => [t.id as string, t.title as string]));
    const iMap = new Map((items ?? []).map((i) => [i.id as string, { n: i.name_snapshot as string, u: (i.unit_label ?? null) as string | null }]));
    setRows(list.map((s) => ({
      ...s,
      task_title: tMap.get(s.task_id) ?? "Tugas",
      item_name: iMap.get(s.task_item_id)?.n ?? "-",
      unit_label: iMap.get(s.task_item_id)?.u ?? null,
    })));
  }

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("home:prep_submissions")
      .on("postgres_changes", { event: "*", schema: "public", table: "prep_submissions" }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Kiriman Pegawai Terbaru</p>
        <Link to="/tugas" className="text-[11px] font-medium text-primary hover:underline">Buka Tugas →</Link>
      </div>
      {rows === null ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-md" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-md border border-dashed bg-card p-4 text-center text-xs text-muted-foreground">
          <Inbox className="h-4 w-4 opacity-60" />
          <span>Belum ada kiriman dari pegawai.</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {rows.map((r) => <Thumb key={r.id} row={r} />)}
        </div>
      )}
    </section>
  );
}

function Thumb({ row }: { row: Row }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (row.photo_path) signedUrl(row.photo_path, 60 * 60).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [row.photo_path]);

  const time = new Date(row.submitted_at);
  const timeLabel = time.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <Link
      to="/tugas"
      className="group flex flex-col gap-1 overflow-hidden rounded-md border bg-card hover:border-primary/40"
      title={`${row.task_title} · ${row.item_name}`}
    >
      <div className="relative aspect-square w-full bg-muted">
        {url ? (
          <img src={url} alt={row.item_name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
            {row.photo_path ? "memuat…" : "tanpa foto"}
          </div>
        )}
        {row.location_url && (
          <span className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
            <MapPin className="h-2.5 w-2.5" /> GPS
          </span>
        )}
      </div>
      <div className="space-y-0.5 px-1.5 pb-1.5">
        <div className="truncate text-[11px] font-semibold">{row.item_name}</div>
        <div className="truncate text-[10px] text-muted-foreground">{row.task_title}</div>
        <div className="text-[9px] text-muted-foreground">{timeLabel}</div>
      </div>
    </Link>
  );
}