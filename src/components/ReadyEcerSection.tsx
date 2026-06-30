import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Scale, Plus, ChevronRight, Search, X, MessageCircle, MapPin, Inbox, RefreshCw, Radio, Loader2, Check, CheckCircle2, XCircle, CircleSlash, Send, CheckSquare, Square, Trash2, ListChecks } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { signedUrl } from "@/lib/prep";
import { ecerSignedUrl } from "@/lib/ecer";
import { shareToWhatsApp, urlToFile, notifyShareResult } from "@/lib/share-wa";
import { shareToChat } from "@/lib/share-chat";
import { PickChatConversationDialog } from "@/components/PickChatConversationDialog";
import { ChatSharePreviewDialog, type ChatSharePreviewData, type ChatShareLiveStatus, type ChatShareDuplicateInfo } from "@/components/ChatSharePreviewDialog";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ExternalLink, History, Undo2 } from "lucide-react";
import { markSent, unmarkSent, useSentShots, useSentDetails, type Entry as SentEntry } from "@/lib/wa-sent-history";
import { buildSendKey, withIdempotency, getIdem, clearIdem, setIdem, payloadFingerprint, type IdemRecord } from "@/lib/idempotency";
import { appendSendLog, appendPayloadDiffLog, getSendLog, resetSendLog, type SendLogEntry } from "@/lib/send-log";

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
  photo_paths?: string[] | null;
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
  // Cross-tab sync banner: 'pending' while applying, 'synced' briefly after.
  const [crossTabSync, setCrossTabSync] = useState<null | { status: "pending" | "synced"; id: string | null }>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  // Tick once a minute so relative time stays current.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Sync productFilter with selection made on /ecer detail page
  useEffect(() => {
    let syncedTimer: number | undefined;
    let pendingTimer: number | undefined;
    function applyId(id: string | null) {
      if (id) {
        setProductFilter(id);
        setSyncedFromDetail(true);
      } else {
        setProductFilter("all");
        setSyncedFromDetail(false);
      }
    }
    function flashCrossTab(id: string | null) {
      window.clearTimeout(syncedTimer);
      window.clearTimeout(pendingTimer);
      setCrossTabSync({ status: "pending", id });
      pendingTimer = window.setTimeout(() => {
        setCrossTabSync({ status: "synced", id });
        setLastSyncedAt(Date.now());
        syncedTimer = window.setTimeout(() => setCrossTabSync(null), 2200);
      }, 350);
    }
    function onCustom(e: Event) {
      const id = (e as CustomEvent<string | null>).detail ?? null;
      applyId(id);
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== "ecer:selectedItemId") return;
      // 'storage' only fires for changes made in OTHER tabs/windows.
      flashCrossTab(e.newValue);
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
      window.clearTimeout(syncedTimer);
      window.clearTimeout(pendingTimer);
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
          .select("id,photo_path,photo_paths,location_url,submitted_at,task_item_id")
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
      const subRows = (subs ?? []) as Array<{ id: string; photo_path: string | null; photo_paths: string[] | null; location_url: string | null; submitted_at: string; task_item_id: string }>;
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
        arr.push({ id: s.id, photo_path: s.photo_path, photo_paths: s.photo_paths, location_url: s.location_url, submitted_at: s.submitted_at, item_name: meta.name, source: "worker" });
        shotsByTitleId.set(titleId, arr);
      }

      // Merge "siapkan sendiri" (ecer_preparations) — already keyed by title_id.
      for (const p of ((preps ?? []) as Array<{ id: string; title_id: string; photo_path: string | null; photo_paths?: string[] | null; location_url: string | null; created_at: string }>)) {
        if (!p.photo_path && !(p.photo_paths && p.photo_paths.length)) continue;
        const arr = shotsByTitleId.get(p.title_id) ?? [];
        arr.push({
          id: `self:${p.id}`,
          photo_path: p.photo_path ?? (p.photo_paths?.[0] ?? null),
          photo_paths: p.photo_paths ?? null,
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
  const [view, setView] = useState<"active" | "sent">("active");
  const sentMap = useSentShots();
  const sentDetails = useSentDetails();
  // Split each row's shots into active vs sent based on local history.
  const rowsForView = (filtered ?? []).map((r) => {
    const active: WorkerShot[] = [];
    const sent: WorkerShot[] = [];
    for (const s of r.worker_shots) (sentMap.has(s.id) ? sent : active).push(s);
    const sentTimes = sent.map((s) => sentMap.get(s.id) ?? 0).filter((n) => n > 0);
    const lastSentAt = sentTimes.length ? Math.max(...sentTimes) : null;
    return {
      ...r,
      worker_shots: view === "sent" ? sent : active,
      _sentCount: sent.length,
      _activeCount: active.length,
      _lastSentAt: lastSentAt,
    };
  });
  const totalActive = rowsForView.reduce((a, r) => a + r._activeCount, 0);
  const totalSent = rowsForView.reduce((a, r) => a + r._sentCount, 0);
  const rowsAfterView = rowsForView.filter((r) => (view === "sent" ? r._sentCount > 0 : true));
  const syncCounts = (rows ?? []).reduce<Record<SyncLevel, number>>((acc, r) => {
    acc[r.sync.level] = (acc[r.sync.level] ?? 0) + 1;
    return acc;
  }, { ok: 0, fallback_grams: 0, fallback_wid: 0, self_only: 0, no_match: 0, no_wid: 0, empty: 0 });
  const visible = rowsAfterView.filter((r) => syncFilter === "all" || r.sync.level === syncFilter);

  function formatRelative(ts: number, now: number): string {
    const diff = Math.max(0, now - ts);
    const sec = Math.floor(diff / 1000);
    if (sec < 10) return "baru saja";
    if (sec < 60) return `${sec} dtk lalu`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} mnt lalu`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} jam lalu`;
    return new Date(ts).toLocaleString();
  }
  function formatAbsolute(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

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

      {crossTabSync && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-[11px] transition-colors ${
            crossTabSync.status === "pending"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            {crossTabSync.status === "pending" ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            ) : (
              <Check className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">
              {crossTabSync.status === "pending"
                ? "Menyinkronkan filter dari tab lain…"
                : crossTabSync.id
                  ? `Tersinkron: ${(products.find(([id]) => id === crossTabSync.id)?.[1]) ?? "produk terpilih"}`
                  : "Tersinkron: Semua produk"}
            </span>
          </div>
          {crossTabSync.status === "synced" && lastSyncedAt && (
            <time
              dateTime={new Date(lastSyncedAt).toISOString()}
              title={new Date(lastSyncedAt).toLocaleString()}
              className="shrink-0 tabular-nums opacity-80"
            >
              {formatAbsolute(lastSyncedAt)}
            </time>
          )}
        </div>
      )}

      {syncedFromDetail && productFilter !== "all" && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] text-primary">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate">
              Disinkron dari detail: {(products.find(([id]) => id === productFilter)?.[1]) ?? "produk terpilih"}
            </span>
            {lastSyncedAt && (
              <time
                dateTime={new Date(lastSyncedAt).toISOString()}
                title={new Date(lastSyncedAt).toLocaleString()}
                className="shrink-0 tabular-nums opacity-70"
              >
                · {formatRelative(lastSyncedAt, nowTick)}
              </time>
            )}
          </div>
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

      {rows && rows.length > 0 && (
        <div className="flex items-center gap-1 rounded-md border bg-card/50 p-0.5">
          <button
            type="button"
            onClick={() => setView("active")}
            className={`flex-1 rounded px-2 py-1 text-[10.5px] font-semibold transition ${view === "active" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent"}`}
            aria-pressed={view === "active"}
          >
            Aktif <span className="ml-1 font-mono opacity-80">{totalActive}</span>
          </button>
          <button
            type="button"
            onClick={() => setView("sent")}
            className={`flex-1 inline-flex items-center justify-center gap-1 rounded px-2 py-1 text-[10.5px] font-semibold transition ${view === "sent" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent"}`}
            aria-pressed={view === "sent"}
          >
            <History className="h-3 w-3" /> Riwayat terkirim <span className="ml-0.5 font-mono opacity-80">{totalSent}</span>
          </button>
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
          {visible.length === 0 ? (
            <div className="col-span-2 flex flex-col items-center gap-1 rounded-md border border-dashed bg-card/50 p-5 text-center text-[11px] text-muted-foreground">
              {view === "sent" ? (
                <>
                  <History className="h-4 w-4" />
                  <span>Belum ada riwayat terkirim. Tekan tombol WA pada kartu aktif — kiriman akan pindah ke sini.</span>
                </>
              ) : (
                <span>Semua kartu sudah dipindah ke Riwayat terkirim.</span>
              )}
            </div>
          ) : (
            visible.map((r) => (
              <EcerCard key={r.id} row={r} onRefresh={handleRefresh} refreshing={refreshing} syncing={syncing} realtimeStatus={realtimeStatus} view={view} lastSentAt={r._lastSentAt} sentDetails={sentDetails} />
            ))
          )}
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

function EcerCard({ row: r, onRefresh, refreshing, syncing, realtimeStatus, view, lastSentAt, sentDetails }: { row: Row; onRefresh: () => void; refreshing: boolean; syncing: boolean; realtimeStatus: "connecting" | "live" | "offline"; view: "active" | "sent"; lastSentAt: number | null; sentDetails: Map<string, SentEntry> }) {
  void 0;
  return <EcerCardImpl row={r} onRefresh={onRefresh} refreshing={refreshing} syncing={syncing} realtimeStatus={realtimeStatus} view={view} lastSentAt={lastSentAt} sentDetails={sentDetails} />;
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

function fmtAgo(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return "baru saja";
  if (sec < 60) return `${sec} dtk lalu`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} mnt lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.floor(hr / 24);
  return `${day} hari lalu`;
}

function SendStatusBadge({ status, error, view, lastSentAt, sentCount }: {
  status: "idle" | "sending" | "success" | "failed" | "cancelled";
  error: string | null;
  view: "active" | "sent";
  lastSentAt: number | null;
  sentCount: number;
}) {
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  if (status === "sending") {
    return (
      <span onClick={stop} className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Mengirim…
      </span>
    );
  }
  if (status === "failed") {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" onClick={stop} className="inline-flex w-fit items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold text-destructive">
            <XCircle className="h-2.5 w-2.5" /> Gagal kirim
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-1 p-2.5 text-[10px]" onClick={stop}>
          <div className="font-semibold text-foreground">Gagal mengirim ke WhatsApp</div>
          <p className="text-muted-foreground break-words">{error || "Penyebab tidak diketahui."}</p>
          <p className="text-muted-foreground">Tekan tombol WA lagi untuk mencoba ulang.</p>
        </PopoverContent>
      </Popover>
    );
  }
  if (status === "cancelled") {
    return (
      <span onClick={stop} className="inline-flex w-fit items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
        <CircleSlash className="h-2.5 w-2.5" /> Dibatalkan
      </span>
    );
  }
  if (status === "success" || (view === "sent" && lastSentAt)) {
    const label = status === "success" ? "Sukses dikirim" : `Terkirim · ${fmtAgo(lastSentAt!)}`;
    return (
      <span onClick={stop} className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400" title={lastSentAt ? new Date(lastSentAt).toLocaleString() : undefined}>
        <CheckCircle2 className="h-2.5 w-2.5" /> {label}
      </span>
    );
  }
  if (view === "active" && sentCount === 0) {
    return (
      <span onClick={stop} className="inline-flex w-fit items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
        <span className="h-1 w-1 rounded-full bg-muted-foreground/60" /> Belum dikirim
      </span>
    );
  }
  return null;
}

function SyncBadge({ row: r }: { row: Row }) {
  void 0;
  return <SyncBadgeImpl row={r} />;
}

function SentDetailList({ shots, details }: { shots: WorkerShot[]; details: Map<string, SentEntry> }) {
  const rows = shots
    .map((s) => ({ shot: s, entry: details.get(s.id) }))
    .filter((r): r is { shot: WorkerShot; entry: SentEntry } => !!r.entry)
    .sort((a, b) => b.entry.at - a.entry.at);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border bg-muted/40 p-1.5">
      <div className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="h-2.5 w-2.5" /> Detail kiriman ({rows.length})
      </div>
      <ul className="space-y-1">
        {rows.map(({ shot, entry }) => {
          const ok = entry.status !== "failed";
          const channel = entry.channel ?? "wa";
          const time = new Date(entry.at).toLocaleString("id-ID", {
            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
          });
          const maps = entry.mapsUrl ?? shot.location_url ?? null;
          return (
            <li key={shot.id} className="flex flex-wrap items-center gap-1 text-[9px] leading-tight">
              <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${channel === "chat" ? "bg-primary/10 text-primary" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}>
                {channel === "chat" ? <Send className="h-2.5 w-2.5" /> : <MessageCircle className="h-2.5 w-2.5" />}
                {channel === "chat" ? "Chat" : "WA"}
              </span>
              <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-destructive/10 text-destructive"}`}>
                {ok ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                {ok ? "Sukses" : "Gagal"}
              </span>
              <span className="text-muted-foreground" title={new Date(entry.at).toLocaleString()}>{time}</span>
              {maps ? (
                <a
                  href={maps}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto inline-flex items-center gap-0.5 rounded-full bg-sky-500/10 px-1.5 py-0.5 font-semibold text-sky-600 hover:bg-sky-500/20 dark:text-sky-400"
                  title="Buka lokasi di Maps"
                >
                  <MapPin className="h-2.5 w-2.5" /> Maps
                </a>
              ) : (
                <span className="ml-auto text-muted-foreground/70">tanpa lokasi</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SyncBadgeImpl({ row: r }: { row: Row }) {
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

function EcerCardImpl({ row: r, onRefresh, refreshing, syncing, realtimeStatus, view, lastSentAt, sentDetails }: { row: Row; onRefresh: () => void; refreshing: boolean; syncing: boolean; realtimeStatus: "connecting" | "live" | "offline"; view: "active" | "sent"; lastSentAt: number | null; sentDetails: Map<string, SentEntry> }) {
  const [sending, setSending] = useState(false);
  type SendStatus = "idle" | "sending" | "success" | "failed" | "cancelled";
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [pickChatOpen, setPickChatOpen] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [chatPreparing, setChatPreparing] = useState(false);
  const [chatPreviewOpen, setChatPreviewOpen] = useState(false);
  type ChatPreviewState = {
    conversationId: string;
    conversationTitle: string;
    idemKey: string;
    idemIdsKey: string;
    caption: string;
    locationUrl: string | null;
    chatShots: { id: string; file: File; caption?: string }[];
    markIds: string[];
    preview: ChatSharePreviewData;
    duplicate: ChatShareDuplicateInfo | null;
    previousLog: SendLogEntry[];
    fingerprint: string;
    summary: import("@/lib/idempotency").SendPayloadSummary;
  };
  const [chatPreview, setChatPreview] = useState<ChatPreviewState | null>(null);
  const [chatStatus, setChatStatus] = useState<ChatShareLiveStatus | null>(null);
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
    const take = shots.slice(0, 6);
    const idemIdsKey = [...new Set(take.map((s) => s.id).filter(Boolean))].sort().join(",");
    const idemKey = buildSendKey({ channel: "wa", ids: take.map((s) => s.id) });
    const existing = getIdem(idemKey);
    const duplicateRec: IdemRecord | null = existing && existing.status !== "failed" ? existing : null;
    const duplicate = duplicateRec
      ? { at: duplicateRec.at, status: duplicateRec.status, destination: r.name, fingerprint: duplicateRec.fingerprint, summary: duplicateRec.summary }
      : null;
    // Selalu baca log saat ada record (termasuk yang failed) — agar operator
    // bisa melihat penyebab kegagalan kiriman sebelumnya di pratinjau.
    let previousLog = existing ? getSendLog(idemKey) : [];
    const preserveLog = existing?.status === "failed";
    setSending(true);
    setSendStatus("sending");
    setSendError(null);
    try {
      // Bangun daftar slot foto (max 10). Pertahankan slot yang gagal agar bisa di-retry
      // dari pratinjau tanpa mengulang seluruh alur kirim.
      type Slot = { path: string; name: string; source: typeof take[number]["source"] };
      const allSlots: Slot[] = [];
      for (const s of take) {
        const paths = Array.from(new Set([
          ...((s.photo_paths ?? []) as string[]),
          ...(s.photo_path ? [s.photo_path] : []),
        ])).filter(Boolean);
        for (let pi = 0; pi < paths.length; pi++) {
          allSlots.push({ path: paths[pi], name: `${r.name}-${s.id.slice(0, 6)}-${pi + 1}.jpg`, source: s.source });
        }
      }
      const slots = allSlots.slice(0, 10);
      async function fetchSlots(list: Slot[]): Promise<{ ok: File[]; failed: Slot[] }> {
        const ok: File[] = [];
        const failed: Slot[] = [];
        for (const sl of list) {
          const url = await resolveShotSignedUrl(sl.path, sl.source, 600);
          const f = url ? await urlToFile(url, sl.name) : null;
          if (f) ok.push(f);
          else failed.push(sl);
        }
        return { ok, failed };
      }
      const initial = await fetchSlots(slots);
      const files: File[] = [...initial.ok];
      let pendingSlots: Slot[] = initial.failed;
      const expectedCount = slots.length;
      const retryMissing = async (): Promise<File[]> => {
        if (pendingSlots.length === 0) return [];
        const { ok, failed } = await fetchSlots(pendingSlots);
        pendingSlots = failed;
        return ok;
      };
      if (files.length === 0) {
        toast.warning("Foto pegawai tidak bisa diunduh untuk dilampirkan ke WA.");
      }
      const lines = take.map((s) => `• ${r.name} — ${new Date(s.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`);
      const firstLocation = take.find((s) => s.location_url)?.location_url ?? null;
      const text = [
        `*${r.name}* (${r.product_name} · ${r.target_grams} ${unit})`,
        `${shots.length} kiriman pegawai${extra > 0 ? ` (mengirim ${take.length})` : ""} · ${files.length} foto terlampir:`,
        ...lines,
      ].join("\n");
      // Fingerprint payload WA: caption + link + daftar slot foto (path & nama).
      // Stabil terhadap urutan dan dipakai untuk membandingkan dengan payload
      // kiriman sebelumnya pada idempotency key yang sama.
      const waFingerprint = payloadFingerprint({
        channel: "wa",
        text,
        url: firstLocation ?? null,
        expectedCount,
        slots: slots.map((s) => ({ path: s.path, name: s.name })),
      });
      // Ringkasan payload — disimpan di record idempotency agar saat klik
      // ganda terdeteksi, banner pratinjau bisa menampilkan perbedaan field
      // (caption / foto / lokasi / tujuan) dibanding kiriman sebelumnya.
      const waSummary: import("@/lib/idempotency").SendPayloadSummary = {
        channel: "wa",
        destination: r.name,
        caption: text,
        photoCount: files.length,
        locationUrl: firstLocation ?? null,
      };
      // Catat snapshot diff payload bila kiriman sebelumnya gagal atau sidik
      // jari berbeda — supaya bisa direview lewat "Lihat log kiriman sebelumnya".
      if (existing) {
        const prevFp = existing.fingerprint;
        const fpMismatch = !!prevFp && prevFp !== waFingerprint;
        const prevFailed = existing.status === "failed";
        if (prevFailed || fpMismatch) {
          appendPayloadDiffLog(
            idemKey,
            existing.summary ?? null,
            waSummary,
            prevFailed
              ? "Kiriman WA sebelumnya gagal — bandingkan payload"
              : "Sidik jari payload tidak cocok dengan kiriman WA sebelumnya",
          );
          previousLog = getSendLog(idemKey);
        }
      }
      const callShare = () => shareToWhatsApp({
            text,
            title: r.name,
            files,
            url: firstLocation ?? undefined,
            expectedCount,
            retryMissing,
            duplicate,
            previousLog,
            currentFingerprint: waFingerprint,
            currentSummary: waSummary,
            idemIdsKey,
          });
      // Saat duplikat aktif: bypass withIdempotency agar pratinjau (yang sekarang
      // memuat peringatan "Klik ganda terdeteksi") selalu tampil. Jika operator
      // memilih Kirim ulang (paksa), `shareToWhatsApp` mengembalikan shared/fallback —
      // bersihkan record lama sebelum menulis record baru.
      let res: { status: "shared"; error?: string };
      if (duplicate) {
        const r0 = await callShare();
        notifyShareResult(r0);
        if (r0.status === "shared" || r0.status === "fallback") {
          clearIdem(idemKey);
          setIdem(idemKey, "done", undefined, waFingerprint, waSummary);
          markSent(take.map((s) => s.id), { channel: "wa", mapsUrl: firstLocation, status: "success", idemKey });
          res = { status: "shared" };
        } else if (r0.status === "cancelled") {
          throw new Error("__cancelled__");
        } else {
          throw new Error(r0.error || "share-failed");
        }
      } else {
        // Pertahankan log saat percobaan sebelumnya gagal agar operator
        // tetap bisa melihat urutan langkah + diff payloadnya.
        if (!preserveLog) resetSendLog(idemKey);
        appendSendLog(idemKey, { kind: "info", label: `Mulai kirim WA ke "${r.name}"`, detail: `${take.length} kiriman · ${files.length}/${expectedCount} foto` });
        res = await withIdempotency(idemKey, {
          onSkip: () => ({ status: "shared" as const, error: undefined as string | undefined }),
          fingerprint: waFingerprint,
          summary: waSummary,
          run: async () => {
          const r0 = await callShare();
          notifyShareResult(r0);
          if (r0.status === "shared" || r0.status === "fallback") {
            markSent(take.map((s) => s.id), { channel: "wa", mapsUrl: firstLocation, status: "success", idemKey });
            appendSendLog(idemKey, { kind: "step", label: r0.status === "shared" ? "WA dibagikan (Web Share / native)" : "WA dibuka via fallback wa.me" });
            appendSendLog(idemKey, { kind: "outcome", label: "Selesai" });
            return { status: "shared" as const, error: undefined as string | undefined };
          }
          if (r0.status === "cancelled") {
            appendSendLog(idemKey, { kind: "outcome", label: "Dibatalkan oleh pengguna" });
            throw new Error("__cancelled__");
          }
          appendSendLog(idemKey, { kind: "error", label: "Gagal kirim WA", detail: r0.error });
          throw new Error(r0.error || "share-failed");
        },
      });
      }
      void res;
      setSendStatus("success");
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "__cancelled__") {
        setSendStatus("cancelled");
      } else {
        toast.error(`Gagal kirim WA: ${msg}`);
        setSendStatus("failed");
        setSendError(msg);
      }
    } finally {
      setSending(false);
    }
  }

  function undoSent(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    unmarkSent(shots.map((s) => s.id));
    toast.message("Dikembalikan ke daftar aktif.");
  }

  async function prepareChat(conversationId: string, convTitle: string) {
    if (chatSending || chatPreparing) return;
    if (shots.length === 0) {
      toast.info("Belum ada kiriman pegawai untuk judul ini.");
      return;
    }
    const take = shots.slice(0, 6);
    const idemIdsKey = [...new Set(take.map((s) => s.id).filter(Boolean))].sort().join(",");
    const idemKey = buildSendKey({ channel: "chat", conversationId, ids: take.map((s) => s.id) });
    const existing = getIdem(idemKey);
    const duplicate: ChatShareDuplicateInfo | null =
      existing && existing.status !== "failed"
        ? { at: existing.at, status: existing.status, destination: convTitle, fingerprint: existing.fingerprint, summary: existing.summary }
        : null;
    let previousLog = existing ? getSendLog(idemKey) : [];
    setPickChatOpen(false);
    setChatPreparing(true);
    setSendError(null);
    const tid = toast.loading(`Menyiapkan pratinjau untuk ${convTitle}…`);
    try {
      // Kumpulkan file dari setiap shot (foto-foto sudah punya signed URL via load()).
      const chatShots: { id: string; file: File; caption?: string }[] = [];
      let attemptedPaths = 0;
      const thumbUrls: string[] = [];
      for (const s of take) {
        const paths = Array.from(new Set([
          ...((s.photo_paths ?? []) as string[]),
          ...(s.photo_path ? [s.photo_path] : []),
        ])).filter(Boolean);
        if (paths.length === 0) continue;
        for (let pi = 0; pi < paths.length; pi++) {
          const p = paths[pi];
          attemptedPaths++;
          const url = await resolveShotSignedUrl(p, s.source, 600);
          if (!url) continue;
          const f = await urlToFile(url, `${r.name}-${s.id.slice(0, 6)}-${pi + 1}.jpg`);
          if (f) {
            chatShots.push({ id: `${s.id}:${pi}`, file: f });
            if (thumbUrls.length < 4) thumbUrls.push(url);
          }
          if (chatShots.length >= 10) break;
        }
        if (chatShots.length >= 10) break;
      }
      const firstLocation = take.find((s) => s.location_url)?.location_url ?? null;
      const lines = take.map((s) => `• ${r.name} — ${new Date(s.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`);
      const caption = [
        `*${r.name}* (${r.product_name} · ${r.target_grams} ${unit})`,
        `${shots.length} kiriman pegawai${shots.length > take.length ? ` (mengirim ${take.length})` : ""} · ${chatShots.length} foto terlampir:`,
        ...lines,
      ].join("\n");
      toast.dismiss(tid);
      const preview: ChatSharePreviewData = {
        conversationTitle: convTitle,
        caption,
        photoCount: chatShots.length,
        thumbs: thumbUrls,
        totalPhotos: chatShots.length,
        missingPhotos: Math.max(0, attemptedPaths - chatShots.length),
        mapsUrl: firstLocation,
      };
      // Fingerprint payload Chat: caption + conv + lokasi + daftar id foto.
      // Dipakai untuk membandingkan dengan payload kiriman sebelumnya agar
      // tombol "Kirim ulang (paksa)" hanya aktif saat konten benar-benar sama.
      const chatFingerprint = payloadFingerprint({
        channel: "chat",
        conversationId,
        caption,
        locationUrl: firstLocation ?? null,
        shotIds: [...chatShots.map((s) => s.id)].sort(),
      });
      const chatSummary: import("@/lib/idempotency").SendPayloadSummary = {
        channel: "chat",
        destination: convTitle,
        caption,
        photoCount: chatShots.length,
        locationUrl: firstLocation ?? null,
      };
      // Simpan snapshot diff payload bila kiriman chat sebelumnya gagal atau
      // sidik jari berbeda — tampilkan di "Lihat log kiriman sebelumnya".
      if (existing) {
        const prevFp = existing.fingerprint;
        const fpMismatch = !!prevFp && prevFp !== chatFingerprint;
        const prevFailed = existing.status === "failed";
        if (prevFailed || fpMismatch) {
          appendPayloadDiffLog(
            idemKey,
            existing.summary ?? null,
            chatSummary,
            prevFailed
              ? "Kiriman Chat sebelumnya gagal — bandingkan payload"
              : "Sidik jari payload tidak cocok dengan kiriman Chat sebelumnya",
          );
          previousLog = getSendLog(idemKey);
        }
      }
      setChatPreview({
        conversationId,
        conversationTitle: convTitle,
        idemKey,
        idemIdsKey,
        caption,
        locationUrl: firstLocation,
        chatShots,
        markIds: take.map((s) => s.id),
        preview,
        duplicate,
        previousLog,
        fingerprint: chatFingerprint,
        summary: chatSummary,
      });
      setChatPreviewOpen(true);
    } catch (err) {
      toast.dismiss(tid);
      const msg = (err as Error).message;
      setSendStatus("failed");
      setSendError(msg);
      toast.error(`Gagal menyiapkan pratinjau: ${msg}`);
    } finally {
      setChatPreparing(false);
    }
  }

  async function confirmChatSend(opts?: { force?: boolean }) {
    const ctx = chatPreview;
    if (!ctx || chatSending) return;
    // Jika operator menekan "Kirim ulang (paksa)" pada banner duplikat, bersihkan
    // record lama agar withIdempotency tidak men-skip eksekusi.
    if (opts?.force) {
      clearIdem(ctx.idemKey);
    }
    resetSendLog(ctx.idemKey);
    appendSendLog(ctx.idemKey, { kind: "info", label: `Mulai kirim Chat ke "${ctx.conversationTitle}"`, detail: `${ctx.chatShots.length} foto${ctx.locationUrl ? " + lokasi" : ""}` });
    const captionStep = ctx.caption.trim().length > 0;
    const locationStep = !!(ctx.locationUrl && ctx.locationUrl.trim());
    const photosTotal = ctx.chatShots.length;
    const liveStatus: ChatShareLiveStatus = {
      captionStep,
      captionStatus: captionStep ? "pending" : "ok",
      photosTotal,
      photosSent: 0,
      photosFailed: 0,
      photoCurrent: null,
      locationStep,
      locationStatus: locationStep ? "pending" : "ok",
      outcome: null,
    };
    setChatStatus(liveStatus);
    setChatSending(true);
    setSendStatus("sending");
    setSendError(null);
    try {
      const res = await withIdempotency(ctx.idemKey, {
        onSkip: () => ({ status: "shared" as const, messageCount: 0, error: undefined as string | undefined }),
        fingerprint: ctx.fingerprint,
        summary: ctx.summary,
        run: async () => {
          const r0 = await shareToChat({
            conversationId: ctx.conversationId,
            caption: ctx.caption,
            locationUrl: ctx.locationUrl,
            shots: ctx.chatShots,
            markIds: ctx.markIds,
            idemKey: ctx.idemKey,
            onProgress: (p) => {
              if (p.type === "caption") {
                if (p.status === "start") appendSendLog(ctx.idemKey, { kind: "step", label: "Mengirim caption…" });
                else if (p.status === "ok") appendSendLog(ctx.idemKey, { kind: "step", label: "Caption terkirim" });
                else if (p.status === "fail") appendSendLog(ctx.idemKey, { kind: "error", label: "Caption gagal", detail: p.error });
              } else if (p.type === "photo") {
                if (p.status === "start") appendSendLog(ctx.idemKey, { kind: "step", label: `Mengirim foto ${p.index + 1}/${p.total}…` });
                else if (p.status === "ok") appendSendLog(ctx.idemKey, { kind: "step", label: `Foto ${p.index + 1}/${p.total} terkirim` });
                else if (p.status === "fail") appendSendLog(ctx.idemKey, { kind: "error", label: `Foto ${p.index + 1}/${p.total} gagal`, detail: p.error });
              } else if (p.type === "location") {
                if (p.status === "start") appendSendLog(ctx.idemKey, { kind: "step", label: "Mengirim link Maps…" });
                else if (p.status === "ok") appendSendLog(ctx.idemKey, { kind: "step", label: "Link Maps terkirim" });
                else if (p.status === "fail") appendSendLog(ctx.idemKey, { kind: "error", label: "Link Maps gagal", detail: p.error });
              }
              setChatStatus((prev) => {
                if (!prev) return prev;
                const next = { ...prev };
                if (p.type === "caption") {
                  next.captionStatus = p.status === "ok" ? "ok" : p.status === "fail" ? "fail" : "running";
                } else if (p.type === "photo") {
                  if (p.status === "start") next.photoCurrent = p.index;
                  else if (p.status === "ok") { next.photosSent = prev.photosSent + 1; next.photoCurrent = null; }
                  else if (p.status === "fail") { next.photosFailed = prev.photosFailed + 1; next.photoCurrent = null; }
                } else if (p.type === "location") {
                  next.locationStatus = p.status === "ok" ? "ok" : p.status === "fail" ? "fail" : "running";
                }
                return next;
              });
            },
          });
          if (r0.status !== "shared") throw new Error(r0.error || "share-failed");
          return r0;
        },
      });
      setSendStatus("success");
      const msgCount = "messageCount" in res ? res.messageCount ?? 0 : 0;
      appendSendLog(ctx.idemKey, { kind: "outcome", label: `Selesai · ${msgCount} pesan terkirim` });
      setChatStatus((prev) => prev ? {
        ...prev,
        outcome: {
          kind: prev.photosFailed > 0 ? "partial" : "success",
          messageCount: msgCount,
        },
      } : prev);
    } catch (err) {
      const msg = (err as Error).message;
      setSendStatus("failed");
      setSendError(msg);
      appendSendLog(ctx.idemKey, { kind: "error", label: "Gagal mengirim ke chat", detail: msg });
      setChatStatus((prev) => prev ? {
        ...prev,
        outcome: { kind: "failed", messageCount: 0, error: msg },
      } : prev);
    } finally {
      setChatSending(false);
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
          <SendStatusBadge
            status={sendStatus}
            error={sendError}
            view={view}
            lastSentAt={lastSentAt}
            sentCount={view === "sent" ? shots.length : 0}
          />
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
          <>
          {view === "sent" && (
            <SentDetailList shots={shots} details={sentDetails} />
          )}
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
              {sending ? "…" : view === "sent" ? "Kirim ulang" : "WA"}
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPickChatOpen(true); }}
              disabled={chatSending || chatPreparing}
              aria-label="Kirim via Chat aplikasi"
              title="Kirim ke percakapan dalam aplikasi"
              className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-primary px-2 text-[10px] font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
            >
              {(chatSending || chatPreparing) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              {chatPreparing ? "Siap…" : "Chat"}
            </button>
            {view === "sent" && (
              <button
                type="button"
                onClick={undoSent}
                aria-label="Kembalikan ke aktif"
                className="inline-flex h-7 items-center justify-center gap-1 rounded-md border bg-card px-2 text-[10px] font-semibold text-muted-foreground hover:bg-accent"
              >
                <Undo2 className="h-3 w-3" /> Aktif
              </button>
            )}
          </div>
          </>
        )}
      </div>
      <PickChatConversationDialog
        open={pickChatOpen}
        onOpenChange={setPickChatOpen}
        onPick={(id, title) => { void prepareChat(id, title); }}
        title={`Kirim "${r.name}" ke percakapan`}
      />
      <ChatSharePreviewDialog
        open={chatPreviewOpen}
        onOpenChange={(o) => {
          if (chatSending) return;
          setChatPreviewOpen(o);
          if (!o) { setChatPreview(null); setChatStatus(null); }
        }}
        data={chatPreview?.preview ?? null}
        sending={chatSending}
        onConfirm={() => { void confirmChatSend(); }}
        status={chatStatus}
        onRetry={() => { setChatStatus(null); void confirmChatSend(); }}
        duplicate={chatPreview?.duplicate ?? null}
        onForceSend={() => { void confirmChatSend({ force: true }); }}
        previousLog={chatPreview?.previousLog ?? []}
        currentFingerprint={chatPreview?.fingerprint}
        currentSummary={chatPreview?.summary}
        idemIdsKey={chatPreview?.idemIdsKey}
      />
    </div>
  );
}