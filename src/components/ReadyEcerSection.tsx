import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Scale, Plus, ChevronRight, Search, X, MessageCircle, MapPin, Inbox, RefreshCw, Radio, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { signedUrl } from "@/lib/prep";
import { ecerSignedUrl } from "@/lib/ecer";
import { shareToWhatsApp, urlToFile, notifyShareResult } from "@/lib/share-wa";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ExternalLink } from "lucide-react";

// Foto pegawai disimpan di bucket `prep-photos`; siapkan sendiri di `ecer-photos`.
// Selalu coba bucket sesuai source dulu, lalu fallback ke bucket satunya agar lampiran WA tidak hilang.
async function resolveShotSignedUrl(
  path: string,
  source: "worker" | "self",
  expiresIn = 60 * 60,
): Promise<string | null> {
  const primary = source === "worker" ? signedUrl : ecerSignedUrl;
  const secondary = source === "worker" ? ecerSignedUrl : signedUrl;
  const a = await primary(path, expiresIn);
  if (a) return a;
  return await secondary(path, expiresIn);
}

type WorkerShot = {
  id: string;
  photo_path: string | null;
  location_url: string | null;
  submitted_at: string;
  item_name: string;
  thumb_url?: string | null;
  source: "worker" | "self";
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
  sync: SyncStatus;
};

type SyncLevel = "ok" | "fallback_grams" | "fallback_wid" | "self_only" | "no_match" | "no_wid" | "empty";
type SyncStatus = {
  level: SyncLevel;
  worker_total: number;
  self_total: number;
  strict: number;
  fallback_grams: number;
  fallback_wid: number;
  product_submission_count: number; // worker subs that reference same warehouse_item_id (any size)
  reason: string;
};

export function ReadyEcerSection() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState("");
  const [productFilter, setProductFilter] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    try { return localStorage.getItem("ecer:selectedItemId") || "all"; } catch { return "all"; }
  });
  const [syncedFromDetail, setSyncedFromDetail] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return !!localStorage.getItem("ecer:selectedItemId"); } catch { return false; }
  });
  const [refreshing, setRefreshing] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [syncing, setSyncing] = useState(false);

  // Sync productFilter with selection made on /ecer detail page
  useEffect(() => {
    function applyId(id: string | null) {
      if (id) {
        setProductFilter(id);
        setSyncedFromDetail(true);
      } else {
        setProductFilter("all");
        setSyncedFromDetail(false);
      }
    }
    function onCustom(e: Event) {
      const id = (e as CustomEvent<string | null>).detail ?? null;
      applyId(id);
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== "ecer:selectedItemId") return;
      applyId(e.newValue);
    }
    window.addEventListener("ecer:selectedItemId", onCustom as EventListener);
    window.addEventListener("storage", onStorage);
    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      try { applyId(localStorage.getItem("ecer:selectedItemId")); } catch { /* ignore */ }
    }
    function onFocus() { onVisibility(); }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("ecer:selectedItemId", onCustom as EventListener);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

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
      const [{ data: items }, { data: preps }, { data: subs }, { data: selfPreps }] = await Promise.all([
        sb.from("warehouse_items").select("id,name").in("id", itemIds),
        sb.from("ecer_preparations")
          .select("id,title_id,photo_path,location_url,created_at")
          .in("title_id", titleIds)
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(200),
        sb
          .from("prep_submissions")
          .select("id,photo_path,location_url,submitted_at,task_item_id")
          .gte("submitted_at", sinceIso)
          .order("submitted_at", { ascending: false })
          .limit(200),
        Promise.resolve({ data: null }),
      ]);
      const itemMap = new Map<string, string>(((items ?? []) as Array<{ id: string; name: string }>).map((i) => [i.id, i.name]));
      const countMap = new Map<string, number>();
      for (const p of ((preps ?? []) as Array<{ title_id: string }>)) {
        countMap.set(p.title_id, (countMap.get(p.title_id) ?? 0) + 1);
      }
      void selfPreps;

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
      // Track per-title match quality + per-product submission counts
      const matchStats = new Map<string, { strict: number; fallback_grams: number; fallback_wid: number }>();
      const subsPerWid = new Map<string, number>();
      for (const t of list) matchStats.set(t.id, { strict: 0, fallback_grams: 0, fallback_wid: 0 });
      for (const s of subRows) {
        const meta = metaByItemId.get(s.task_item_id);
        if (!meta) continue;
        const wid = meta.warehouse_item_id;
        const g = Number(meta.qty_requested) || 0;
        const u = normUnit(meta.unit_label);
        if (wid) subsPerWid.set(wid, (subsPerWid.get(wid) ?? 0) + 1);
        let titleId: string | undefined;
        let matchKind: "strict" | "fallback_grams" | "fallback_wid" | null = null;
        if (wid) {
          const strictId = titleStrict.get(`${wid}|${g}|${u}`);
          if (strictId) { titleId = strictId; matchKind = "strict"; }
          else {
            const gId = titleByWidGrams.get(`${wid}|${g}`)?.[0];
            if (gId) { titleId = gId; matchKind = "fallback_grams"; }
            else {
              const wId = titleByWid.get(wid)?.[0];
              if (wId) { titleId = wId; matchKind = "fallback_wid"; }
            }
          }
        }
        if (!titleId) continue; // require warehouse match — name-only is unreliable
        if (matchKind) {
          const st = matchStats.get(titleId);
          if (st) st[matchKind] += 1;
        }
        const arr = shotsByTitleId.get(titleId) ?? [];
        arr.push({ id: s.id, photo_path: s.photo_path, location_url: s.location_url, submitted_at: s.submitted_at, item_name: meta.name, source: "worker" });
        shotsByTitleId.set(titleId, arr);
      }

      // Merge "siapkan sendiri" (ecer_preparations) — already keyed by title_id.
      for (const p of ((preps ?? []) as Array<{ id: string; title_id: string; photo_path: string | null; location_url: string | null; created_at: string }>)) {
        if (!p.photo_path) continue;
        const arr = shotsByTitleId.get(p.title_id) ?? [];
        arr.push({
          id: `self:${p.id}`,
          photo_path: p.photo_path,
          location_url: p.location_url,
          submitted_at: p.created_at,
          item_name: "",
          source: "self",
        });
        shotsByTitleId.set(p.title_id, arr);
      }
      // Sort merged shots by recency per title.
      for (const [, arr] of shotsByTitleId) {
        arr.sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
      }

      const shotsByName = shotsByTitleId; // reuse name below
      // Resolve signed URLs for ALL shots so WA share can attach every photo,
      // memilih bucket sesuai source (worker→prep-photos, self→ecer-photos) dengan fallback.
      const thumbJobs: Promise<void>[] = [];
      for (const arr of shotsByName.values()) {
        for (const shot of arr) {
          if (!shot.photo_path) continue;
          thumbJobs.push(
            resolveShotSignedUrl(shot.photo_path, shot.source).then((u) => { shot.thumb_url = u; })
          );
        }
      }
      await Promise.all(thumbJobs);

      setRows(list.map((t) => {
        const shots = shotsByName.get(t.id) ?? [];
        const workerTotal = shots.filter((s) => s.source === "worker").length;
        const selfTotal = shots.filter((s) => s.source === "self").length;
        const st = matchStats.get(t.id) ?? { strict: 0, fallback_grams: 0, fallback_wid: 0 };
        const productSubs = t.warehouse_item_id ? (subsPerWid.get(t.warehouse_item_id) ?? 0) : 0;
        let level: SyncLevel;
        let reason: string;
        if (!t.warehouse_item_id) {
          level = "no_wid";
          reason = "Judul ini belum punya warehouse_item_id, jadi tidak bisa dicocokkan dengan kiriman pegawai.";
        } else if (st.strict > 0) {
          level = "ok";
          reason = `${st.strict} kiriman pegawai cocok persis (produk + ${t.target_grams}${normUnit(t.unit_label)}).`;
        } else if (st.fallback_grams > 0) {
          level = "fallback_grams";
          reason = `Cocok lewat fallback: produk + ukuran ${t.target_grams}, tapi unit di tugas pegawai berbeda.`;
        } else if (st.fallback_wid > 0) {
          level = "fallback_wid";
          reason = `Cocok lewat fallback longgar: hanya warehouse_item_id (ukuran/unit beda).`;
        } else if (productSubs > 0) {
          level = "no_match";
          reason = `Ada ${productSubs} kiriman pegawai untuk produk ini, tapi ukuran/unit tidak cocok dan tidak ada judul lain yang lebih dekat untuk diisi fallback.`;
        } else if (selfTotal > 0) {
          level = "self_only";
          reason = "Hanya dari 'siapkan sendiri'. Pegawai belum mengirim untuk produk ini.";
        } else {
          level = "empty";
          reason = "Belum ada kiriman pegawai maupun siapkan sendiri untuk produk ini (30 hari terakhir).";
        }
        return {
          ...t,
          prep_count: countMap.get(t.id) ?? 0,
          product_name: itemMap.get(t.warehouse_item_id) ?? "—",
          worker_shots: shots,
          sync: {
            level,
            worker_total: workerTotal,
            self_total: selfTotal,
            strict: st.strict,
            fallback_grams: st.fallback_grams,
            fallback_wid: st.fallback_wid,
            product_submission_count: productSubs,
            reason,
          },
        };
      }));
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
    const unit = (r.product_name.trim().toLowerCase() === "gs" ? "botol" : r.unit_label) ?? "";
    const u = unit.toLowerCase();
    const g = r.target_grams;
    const tokens = [
      r.name,
      r.product_name,
      r.warehouse_item_id ?? "",
      r.id,
      unit,
      `${g}${u}`,                 // "1g", "1botol"
      `${g} ${u}`,                // "1 g"
      `${g}${u === "g" ? "gram" : ""}`, // "1gram"
      `${g} ${u === "g" ? "gram" : ""}`,
    ].map((t) => String(t).toLowerCase());
    return tokens.some((t) => t.includes(q));
  });
  const activeFilters = (q !== "" ? 1 : 0) + (productFilter !== "all" ? 1 : 0);
  const [syncFilter, setSyncFilter] = useStateSyncFilter();
  const syncCounts = (rows ?? []).reduce<Record<SyncLevel, number>>((acc, r) => {
    acc[r.sync.level] = (acc[r.sync.level] ?? 0) + 1;
    return acc;
  }, { ok: 0, fallback_grams: 0, fallback_wid: 0, self_only: 0, no_match: 0, no_wid: 0, empty: 0 });
  const visible = (filtered ?? []).filter((r) => syncFilter === "all" || r.sync.level === syncFilter);

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
              placeholder="Cari judul, produk, kategori (1g, ST, SPR, GS), atau ID…"
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

      {syncedFromDetail && productFilter !== "all" && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] text-primary">
          <span className="truncate">
            Disinkron dari detail: {(products.find(([id]) => id === productFilter)?.[1]) ?? "produk terpilih"}
          </span>
          <button
            type="button"
            onClick={() => {
              setProductFilter("all");
              setSyncedFromDetail(false);
              try {
                localStorage.removeItem("ecer:selectedItemId");
                window.dispatchEvent(new CustomEvent("ecer:selectedItemId", { detail: null }));
              } catch { /* ignore */ }
            }}
            className="shrink-0 rounded px-1.5 py-0.5 hover:bg-primary/10"
          >
            Hapus
          </button>
        </div>
      )}

      {rows && rows.length > 0 && (
        <SyncSummary counts={syncCounts} total={rows.length} active={syncFilter} onChange={setSyncFilter} />
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
          {visible.map((r) => (
            <EcerCard key={r.id} row={r} onRefresh={handleRefresh} refreshing={refreshing} syncing={syncing} realtimeStatus={realtimeStatus} />
          ))}
        </div>
      )}
    </div>
  );
}

function useStateSyncFilter() {
  return useState<SyncLevel | "all">("all");
}

function SyncSummary({ counts, total, active, onChange }: { counts: Record<SyncLevel, number>; total: number; active: SyncLevel | "all"; onChange: (v: SyncLevel | "all") => void }) {
  const order: SyncLevel[] = ["ok", "fallback_grams", "fallback_wid", "self_only", "no_match", "no_wid", "empty"];
  const failing = counts.no_match + counts.no_wid;
  return (
    <div className="rounded-md border bg-card/50 p-1.5">
      <div className="mb-1 flex items-center justify-between px-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status sinkron</span>
        {failing > 0 && (
          <span className="text-[9px] font-semibold text-destructive">{failing} gagal</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onChange("all")}
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${active === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
        >
          Semua <span className="font-mono">{total}</span>
        </button>
        {order.map((lvl) => {
          const n = counts[lvl];
          if (n === 0) return null;
          const meta = SYNC_META[lvl];
          const isActive = active === lvl;
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => onChange(isActive ? "all" : lvl)}
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${meta.cls} ${isActive ? "ring-2 ring-primary/40" : ""}`}
              aria-pressed={isActive}
            >
              <span className={`h-1 w-1 rounded-full ${meta.dot}`} />
              {meta.label} <span className="font-mono">{n}</span>
            </button>
          );
        })}
      </div>
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
  void 0;
  return <EcerCardImpl row={r} onRefresh={onRefresh} refreshing={refreshing} syncing={syncing} realtimeStatus={realtimeStatus} />;
}

const SYNC_META: Record<SyncLevel, { label: string; cls: string; dot: string }> = {
  ok:              { label: "Tersinkron",        cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  fallback_grams:  { label: "Cocok ukuran",      cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",       dot: "bg-amber-500" },
  fallback_wid:    { label: "Cocok produk",      cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",       dot: "bg-amber-500" },
  self_only:       { label: "Mandiri saja",      cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400",             dot: "bg-sky-500" },
  no_match:        { label: "Tidak cocok",       cls: "bg-destructive/10 text-destructive",                       dot: "bg-destructive" },
  no_wid:          { label: "Tanpa produk",      cls: "bg-destructive/10 text-destructive",                       dot: "bg-destructive" },
  empty:           { label: "Belum ada data",    cls: "bg-muted text-muted-foreground",                           dot: "bg-muted-foreground" },
};

function SyncBadge({ row: r }: { row: Row }) {
  const meta = SYNC_META[r.sync.level];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className={`inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${meta.cls}`}
          aria-label={`Status sinkron: ${meta.label}`}
        >
          <span className={`h-1 w-1 rounded-full ${meta.dot}`} />
          {meta.label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 space-y-2 p-2.5 text-[10px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-semibold text-foreground">Status sinkron foto pegawai</div>
        <p className="text-muted-foreground">{r.sync.reason}</p>
        <dl className="space-y-0.5 text-muted-foreground">
          <div className="flex justify-between"><dt>Cocok persis (produk + ukuran + unit):</dt><dd className="font-mono text-foreground/90">{r.sync.strict}</dd></div>
          <div className="flex justify-between"><dt>Cocok ukuran (unit beda):</dt><dd className="font-mono text-foreground/90">{r.sync.fallback_grams}</dd></div>
          <div className="flex justify-between"><dt>Cocok produk saja:</dt><dd className="font-mono text-foreground/90">{r.sync.fallback_wid}</dd></div>
          <div className="flex justify-between"><dt>Total kiriman pegawai (judul ini):</dt><dd className="font-mono text-foreground/90">{r.sync.worker_total}</dd></div>
          <div className="flex justify-between"><dt>Kiriman pegawai untuk produk (semua ukuran):</dt><dd className="font-mono text-foreground/90">{r.sync.product_submission_count}</dd></div>
          <div className="flex justify-between"><dt>Siapkan sendiri:</dt><dd className="font-mono text-foreground/90">{r.sync.self_total}</dd></div>
        </dl>
        {r.sync.level === "no_wid" && (
          <p className="text-destructive">Set warehouse_item_id pada judul ini di halaman Ecer agar bisa dicocokkan.</p>
        )}
        {r.sync.level === "no_match" && (
          <p>Periksa apakah ukuran/unit di tugas pegawai sama persis dengan judul ini ({r.target_grams} {r.unit_label}).</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function EcerCardImpl({ row: r, onRefresh, refreshing, syncing, realtimeStatus }: { row: Row; onRefresh: () => void; refreshing: boolean; syncing: boolean; realtimeStatus: "connecting" | "live" | "offline" }) {
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
        // Pastikan signed url tersedia (fallback bucket bila perlu) supaya foto selalu ikut.
        let url = s.thumb_url ?? null;
        if (!url && s.photo_path) {
          url = await resolveShotSignedUrl(s.photo_path, s.source, 600);
          s.thumb_url = url;
        }
        if (!url) continue;
        const f = await urlToFile(url, `${r.name}-${s.id.slice(0, 6)}.jpg`);
        if (f) files.push(f);
      }
      if (files.length === 0) {
        toast.warning("Foto pegawai tidak bisa diunduh untuk dilampirkan ke WA.");
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
          <SyncBadge row={r} />
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