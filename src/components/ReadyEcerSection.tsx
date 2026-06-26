import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Scale, Plus, ChevronRight, Search, X, MessageCircle, MapPin, Inbox, RefreshCw, Radio, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { signedUrl } from "@/lib/prep";
import { shareToWhatsApp, urlToFile, notifyShareResult } from "@/lib/share-wa";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ExternalLink } from "lucide-react";

type WorkerShot = {
  id: string;
  photo_path: string | null;
  location_url: string | null;
  submitted_at: string;
  item_name: string;
  thumb_url?: string | null;
};

type Row = {
  id: string;
  name: string;
  target_grams: number;
  unit_label: string;
  warehouse_item_id: string;
  prep_count: number;
  product_name: string;
  worker_shots: WorkerShot[];
};

export function ReadyEcerSection() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState("");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [syncing, setSyncing] = useState(false);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

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
      const sinceIso = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
      const [{ data: items }, { data: preps }, { data: subs }] = await Promise.all([
        sb.from("warehouse_items").select("id,name").in("id", itemIds),
        sb.from("ecer_preparations").select("title_id").in("title_id", titleIds),
        sb
          .from("prep_submissions")
          .select("id,photo_path,location_url,submitted_at,task_item_id")
          .gte("submitted_at", sinceIso)
          .order("submitted_at", { ascending: false })
          .limit(200),
      ]);
      const itemMap = new Map<string, string>(((items ?? []) as Array<{ id: string; name: string }>).map((i) => [i.id, i.name]));
      const countMap = new Map<string, number>();
      for (const p of ((preps ?? []) as Array<{ title_id: string }>)) {
        countMap.set(p.title_id, (countMap.get(p.title_id) ?? 0) + 1);
      }

      // Map prep_submissions → task_item attributes, then bucket by product+size.
      const subRows = (subs ?? []) as Array<{ id: string; photo_path: string | null; location_url: string | null; submitted_at: string; task_item_id: string }>;
      const taskItemIds = Array.from(new Set(subRows.map((s) => s.task_item_id))).filter(Boolean);
      type TaskItemMeta = { name: string; warehouse_item_id: string | null; qty_requested: number | null; unit_label: string | null };
      let metaByItemId = new Map<string, TaskItemMeta>();
      if (taskItemIds.length > 0) {
        const { data: tItems } = await sb
          .from("prep_task_items")
          .select("id,name_snapshot,warehouse_item_id,qty_requested,unit_label")
          .in("id", taskItemIds);
        metaByItemId = new Map(
          ((tItems ?? []) as Array<{ id: string; name_snapshot: string | null; warehouse_item_id: string | null; qty_requested: number | null; unit_label: string | null }>).map((i) => [
            i.id,
            {
              name: (i.name_snapshot ?? "").trim().toLowerCase(),
              warehouse_item_id: i.warehouse_item_id,
              qty_requested: i.qty_requested,
              unit_label: (i.unit_label ?? "").trim().toLowerCase(),
            } as TaskItemMeta,
          ])
        );
      }

      // Build lookup keys per title: strict (wid+grams+unit), medium (wid+grams), loose (wid).
      const normUnit = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();
      const titleStrict = new Map<string, string>(); // key → title.id
      const titleByWidGrams = new Map<string, string[]>();
      const titleByWid = new Map<string, string[]>();
      for (const t of list) {
        const wid = t.warehouse_item_id;
        const g = Number(t.target_grams) || 0;
        const u = normUnit(t.unit_label);
        if (wid) {
          titleStrict.set(`${wid}|${g}|${u}`, t.id);
          const a = titleByWidGrams.get(`${wid}|${g}`) ?? [];
          a.push(t.id); titleByWidGrams.set(`${wid}|${g}`, a);
          const b = titleByWid.get(wid) ?? [];
          b.push(t.id); titleByWid.set(wid, b);
        }
      }

      const shotsByTitleId = new Map<string, WorkerShot[]>();
      for (const s of subRows) {
        const meta = metaByItemId.get(s.task_item_id);
        if (!meta) continue;
        const wid = meta.warehouse_item_id;
        const g = Number(meta.qty_requested) || 0;
        const u = normUnit(meta.unit_label);
        let titleId: string | undefined;
        if (wid) {
          titleId = titleStrict.get(`${wid}|${g}|${u}`)
            ?? titleByWidGrams.get(`${wid}|${g}`)?.[0]
            ?? titleByWid.get(wid)?.[0];
        }
        if (!titleId) continue; // require warehouse match — name-only is unreliable
        const arr = shotsByTitleId.get(titleId) ?? [];
        arr.push({ id: s.id, photo_path: s.photo_path, location_url: s.location_url, submitted_at: s.submitted_at, item_name: meta.name });
        shotsByTitleId.set(titleId, arr);
      }

      const shotsByName = shotsByTitleId; // reuse name below
      // Resolve signed URLs for at most 4 thumbs per title.
      const thumbJobs: Promise<void>[] = [];
      for (const arr of shotsByName.values()) {
        for (const shot of arr.slice(0, 4)) {
          if (!shot.photo_path) continue;
          thumbJobs.push(
            signedUrl(shot.photo_path, 60 * 60).then((u) => { shot.thumb_url = u; })
          );
        }
      }
      await Promise.all(thumbJobs);

      setRows(list.map((t) => ({
        ...t,
        prep_count: countMap.get(t.id) ?? 0,
        product_name: itemMap.get(t.warehouse_item_id) ?? "—",
        worker_shots: shotsByName.get(t.id) ?? [],
      })));
  }

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("ready-ecer:prep_submissions")
      .on("postgres_changes", { event: "*", schema: "public", table: "prep_submissions" }, async () => {
        setSyncing(true);
        try { await load(); } finally { setSyncing(false); }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRealtimeStatus("offline");
        else setRealtimeStatus("connecting");
      });
    return () => { supabase.removeChannel(ch); };
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
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Produk Eceran Siap Kirim
          </p>
          <RealtimeBadge status={realtimeStatus} syncing={syncing || refreshing} />
        </div>
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
            <EcerCard key={r.id} row={r} onRefresh={handleRefresh} refreshing={refreshing} syncing={syncing} realtimeStatus={realtimeStatus} />
          ))}
        </div>
      )}
    </div>
  );
}

function RealtimeBadge({ status, syncing }: { status: "connecting" | "live" | "offline"; syncing: boolean }) {
  if (syncing) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Memperbarui…
      </span>
    );
  }
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        Live
      </span>
    );
  }
  if (status === "offline") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-medium text-destructive">
        <Radio className="h-2.5 w-2.5" /> Offline
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Menyambung…
    </span>
  );
}

function EcerCard({ row: r, onRefresh, refreshing, syncing, realtimeStatus }: { row: Row; onRefresh: () => void; refreshing: boolean; syncing: boolean; realtimeStatus: "connecting" | "live" | "offline" }) {
  const [sending, setSending] = useState(false);
  const shots = r.worker_shots;
  const thumbs = shots.slice(0, 4);
  const extra = Math.max(0, shots.length - thumbs.length);
  const unit = r.product_name.trim().toLowerCase() === "gs" ? "botol" : r.unit_label;

  async function sendWA(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (sending) return;
    if (shots.length === 0) {
      toast.info("Belum ada kiriman pegawai untuk judul ini.");
      return;
    }
    setSending(true);
    try {
      const files: File[] = [];
      const take = shots.slice(0, 6); // batasi agar WA tidak tolak
      for (const s of take) {
        if (!s.thumb_url) continue;
        const f = await urlToFile(s.thumb_url, `${r.name}-${s.id.slice(0, 6)}.jpg`);
        if (f) files.push(f);
      }
      const lines = take.map((s) => `• ${r.name} — ${new Date(s.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`);
      const text = [
        `*${r.name}* (${r.product_name} · ${r.target_grams} ${unit})`,
        `${shots.length} kiriman pegawai${extra > 0 ? ` (mengirim ${take.length})` : ""}:`,
        ...lines,
      ].join("\n");
      const res = await shareToWhatsApp({ text, title: r.name, files });
      notifyShareResult(res);
    } catch (err) {
      toast.error(`Gagal kirim WA: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm transition hover:border-primary/40 hover:shadow-md">
      {shots.length > 0 ? (
        <Link
          to="/ecer"
          search={{ item: r.warehouse_item_id, title: r.id, highlight: undefined }}
          className="relative block aspect-[4/3] overflow-hidden bg-muted"
        >
          {thumbs[0]?.thumb_url ? (
            <img src={thumbs[0].thumb_url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">…</div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2">
            <div className="flex items-center gap-1 text-[9px] font-medium text-white/90">
              <Scale className="h-2.5 w-2.5" />
              <span className="truncate">{r.name}</span>
            </div>
          </div>
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-sky-500/95 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm">
            {shots.length} foto
          </span>
          {thumbs[0]?.location_url && (
            <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
              <MapPin className="h-2.5 w-2.5" /> GPS
            </span>
          )}
        </Link>
      ) : null}

      <div className="flex flex-col gap-1.5 p-2">
        <Link
          to="/ecer"
          search={{ item: r.warehouse_item_id, title: r.id, highlight: undefined }}
          className="flex flex-col gap-0.5"
        >
          {shots.length === 0 && (
            <div className="flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 text-primary" />
              <span className="truncate text-xs font-semibold leading-tight">{r.name}</span>
            </div>
          )}
          <span className="truncate text-[10px] font-medium leading-tight text-foreground/80">
            {r.product_name} · {r.target_grams} {unit}
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                className="inline-flex w-fit items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground hover:bg-accent"
              >
                <span className="h-1 w-1 rounded-full bg-primary" />
                Cocok: produk + {r.target_grams}{unit}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-64 space-y-2 p-2.5 text-[10px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="font-semibold text-foreground">Aturan cocok foto</div>
              <dl className="space-y-1 text-muted-foreground">
                <div className="flex gap-1">
                  <dt className="shrink-0">warehouse_item_id:</dt>
                  <dd className="break-all font-mono text-foreground/90">{r.warehouse_item_id}</dd>
                </div>
                <div className="flex gap-1"><dt>ukuran:</dt><dd className="text-foreground/90">{r.target_grams}</dd></div>
                <div className="flex gap-1"><dt>unit:</dt><dd className="text-foreground/90">{unit}</dd></div>
                <div className="flex gap-1">
                  <dt className="shrink-0">title_id:</dt>
                  <dd className="break-all font-mono text-foreground/90">{r.id}</dd>
                </div>
              </dl>
              <p className="text-muted-foreground">
                Fallback: warehouse_item_id + ukuran (unit apa pun), lalu warehouse_item_id saja.
              </p>
              <Link
                to="/ecer"
                search={{ item: r.warehouse_item_id, title: r.id, highlight: undefined }}
                className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/20"
              >
                <ExternalLink className="h-2.5 w-2.5" /> Buka detail item di Ecer
              </Link>
            </PopoverContent>
          </Popover>
          <span className="text-[10px] leading-tight">
            <span className={r.prep_count > 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
              {r.prep_count} kotak siap
            </span>
          </span>
        </Link>

        {shots.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-md border border-dashed bg-muted/40 px-2 py-2.5 text-center">
          {syncing || refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          ) : (
            <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-[10px] font-medium leading-tight text-muted-foreground">
            {syncing || refreshing ? "Memuat kiriman…" : "Belum ada kiriman pegawai"}
          </span>
          <span className="text-[9px] leading-tight text-muted-foreground">
            {realtimeStatus === "live"
              ? "Menunggu foto pegawai — akan muncul otomatis."
              : realtimeStatus === "offline"
              ? "Realtime terputus. Tap Segarkan untuk memuat ulang."
              : "Menyambung ke realtime…"}
          </span>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRefresh(); }}
            disabled={refreshing}
            className="mt-0.5 inline-flex h-6 items-center gap-1 rounded bg-primary/10 px-2 text-[10px] font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-2.5 w-2.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Menyegarkan…" : "Segarkan"}
          </button>
        </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {thumbs.slice(1, 4).map((s) => (
              <div key={s.id} className="relative h-7 w-7 shrink-0 overflow-hidden rounded border border-card bg-muted ring-1 ring-border">
                {s.thumb_url ? (
                  <img src={s.thumb_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : null}
              </div>
            ))}
            {extra > 0 && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-card bg-muted text-[9px] font-semibold text-muted-foreground ring-1 ring-border">
                +{extra}
              </div>
            )}
            <button
              type="button"
              onClick={sendWA}
              disabled={sending}
              aria-label="Kirim ke WhatsApp"
              className="ml-auto inline-flex h-7 items-center justify-center gap-1 rounded-md bg-[#25D366] px-2 text-[10px] font-semibold text-white shadow-sm transition hover:bg-[#1ebe57] disabled:opacity-50"
            >
              <MessageCircle className="h-3 w-3" />
              {sending ? "…" : "WA"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}