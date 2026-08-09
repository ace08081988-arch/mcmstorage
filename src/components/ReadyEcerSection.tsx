import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Scale, Plus, ChevronRight, Search, X, MessageCircle, MapPin, Inbox, RefreshCw, Radio, Loader2, Check, CheckCircle2, XCircle, CircleSlash, Send, CheckSquare, Square, Trash2, ListChecks, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { WaShareButton, ChatShareButton } from "@/components/share/SaleShareButtons";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ExternalLink, History, Undo2, ChevronDown } from "lucide-react";
import { useLayoutMode, layoutGridClass, LayoutModeToggle } from "@/components/LayoutModeToggle";
import { useOnDebtTx } from "@/lib/debt-tx-event";
import { countActiveByTitle, withActivePrepsFilter } from "@/lib/prep-active-selector";
import { measureQuery, QueryMetricNames } from "@/lib/query-metrics";
import { markSent, unmarkSent, useSentShots, useSentDetails, hideSent, useHiddenSent, hydrateSentFromDb, type Entry as SentEntry } from "@/lib/wa-sent-history";
import { confirm as confirmDialog } from "@/lib/confirm";
import { consumeSentTabFlag, SHOW_SENT_EVENT } from "@/lib/ready-ecer-sent-nav";
import { buildSendKey, withIdempotency, getIdem, clearIdem, setIdem, payloadFingerprint, getOrCreateSendSnapshot, type IdemRecord } from "@/lib/idempotency";
import { appendSendLog, appendPayloadDiffLog, getSendLog, resetSendLog, type SendLogEntry } from "@/lib/send-log";
import { withSupabaseQueryTimeout, type SupabaseQueryResult } from "@/lib/supabase-timeout";

// Foto pegawai disimpan di bucket `prep-photos`; siapkan sendiri di `ecer-photos`.
// Selalu coba bucket sesuai source dulu, lalu fallback ke bucket satunya agar lampiran WA tidak hilang.
// Cache URL foto per-path selama masa berlaku tanda tangan dikurangi margin.
// Tanpa ini, setiap pemuatan ulang (realtime, refresh manual) meminta URL
// satu per satu untuk seluruh foto — beban N+1 yang bikin layar terasa berat.
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

async function resolveShotSignedUrl(
  path: string,
  source: "worker" | "self",
  expiresIn = 60 * 60,
): Promise<string | null> {
  const cacheKey = `${source}:${path}`;
  const hit = signedUrlCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.url;
  const primary = source === "worker" ? signedUrl : ecerSignedUrl;
  const secondary = source === "worker" ? ecerSignedUrl : signedUrl;
  const url = (await primary(path, expiresIn)) ?? (await secondary(path, expiresIn));
  if (url) {
    // Margin 5 menit supaya tidak memakai URL yang hampir kedaluwarsa.
    signedUrlCache.set(cacheKey, { url, expiresAt: Date.now() + (expiresIn - 300) * 1000 });
  }
  return url;
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
  // Navigasi bulk WA/Chat wajib lewat halaman /ecer supaya alur pembayaran
  // (Lunas/Hutang/Bayar sebagian) tetap dipanggil sebelum WA/Chat benar-
  // benar terkirim. Sama seperti tombol per-kartu "Kirim ke pembeli".
  const navigate = useNavigate();
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
  // Kiriman pegawai yang tidak cocok dengan judul Ecer manapun. Sebelumnya
  // dilewati diam-diam sehingga admin mengira pegawai belum mengirim.
  const [unmatched, setUnmatched] = useState<{ count: number; names: string[] }>({ count: 0, names: [] });
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

  // Segarkan daftar & ringkasan saat transaksi Tunai / Harga Jual tercatat.
  useOnDebtTx(useCallback(() => { void handleRefresh(); }, []));

  async function load() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data: titles } = await withSupabaseQueryTimeout<SupabaseQueryResult<Array<{ id: string; name: string; target_grams: number; unit_label: string; warehouse_item_id: string }>>>(
        (signal) => sb
          .from("ecer_titles")
          .select("id,name,target_grams,unit_label,warehouse_item_id")
          .order("created_at", { ascending: false })
          .limit(20)
          .abortSignal(signal),
        "ready_ecer_titles",
      );
      const list = (titles ?? []) as Array<{ id: string; name: string; target_grams: number; unit_label: string; warehouse_item_id: string }>;
      if (list.length === 0) { setRows([]); return; }
      const itemIds = Array.from(new Set(list.map((t) => t.warehouse_item_id)));
      const titleIds = list.map((t) => t.id);
      const sinceIso = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
      const [{ data: items }, { data: preps }, { data: subs }, { data: selfPreps }] = await Promise.all([
        withSupabaseQueryTimeout<SupabaseQueryResult<Array<{ id: string; name: string }>>>(
          (signal) => sb.from("warehouse_items").select("id,name").in("id", itemIds).abortSignal(signal),
          "ready_ecer_items",
        ),
        // Filter server-side "aktif" WAJIB via helper — mengunci semantik
        // "sold_at IS NULL" ke satu tempat (@/lib/prep-active-selector).
        // Kalau definisi "aktif" bergeser di masa depan, satu edit di
        // helper langsung merambat ke semua badge.
        withSupabaseQueryTimeout<SupabaseQueryResult<Array<{ id: string; title_id: string; sold_at: string | null; photo_path: string | null; location_url: string | null; created_at: string }>>>(
          (signal) => measureQuery(QueryMetricNames.ecerPrepAktif, () =>
            withActivePrepsFilter(
              sb.from("ecer_preparations")
                .select("id,title_id,sold_at,photo_path,location_url,created_at")
                .in("title_id", titleIds)
            )
              .gte("created_at", sinceIso)
              .order("created_at", { ascending: false })
              .limit(200)
              .abortSignal(signal),
            { titles: titleIds.length },
          ) as Promise<SupabaseQueryResult<Array<{ id: string; title_id: string; sold_at: string | null; photo_path: string | null; location_url: string | null; created_at: string }>>>,
          "ready_ecer_preps",
        ),
        withSupabaseQueryTimeout<SupabaseQueryResult<Array<{ id: string; photo_path: string | null; photo_paths: string[] | null; location_url: string | null; submitted_at: string; task_item_id: string; sent_at: string | null; sent_channel: string | null; sent_maps_url: string | null }>>>(
          (signal) => sb
            .from("prep_submissions")
            .select("id,photo_path,photo_paths,location_url,submitted_at,task_item_id,sent_at,sent_channel,sent_maps_url")
            .gte("submitted_at", sinceIso)
            .order("submitted_at", { ascending: false })
            .limit(200)
            .abortSignal(signal),
          "ready_ecer_prep_submissions",
        ),
        Promise.resolve({ data: null }),
      ]);
      const itemMap = new Map<string, string>(((items ?? []) as Array<{ id: string; name: string }>).map((i) => [i.id, i.name]));
      // Badge "N kotak siap" WAJIB memakai selector tunggal supaya konsisten
      // dengan ReadyRequestSection dan detail ecer. Filter `sold_at IS NULL`
      // sudah diterapkan di server, tapi helper klien tetap dipakai sebagai
      // sabuk pengaman.
      const countMap = countActiveByTitle(
        (preps ?? []) as Array<{ title_id: string; sold_at: string | null }>,
      );
      void selfPreps;

      // Map prep_submissions → task_item attributes, then bucket by product+size.
      const subRows = (subs ?? []) as Array<{ id: string; photo_path: string | null; photo_paths: string[] | null; location_url: string | null; submitted_at: string; task_item_id: string; sent_at: string | null; sent_channel: string | null; sent_maps_url: string | null }>;
      // H6: SSOT sent tracker sekarang di DB (`prep_submissions.sent_at`).
      // Hydrate overlay lokal supaya kartu tetap di "Terkirim" walau
      // localStorage baru (ganti perangkat / clear cache).
      hydrateSentFromDb(subRows.map((r) => ({
        id: r.id,
        sent_at: r.sent_at,
        sent_channel: r.sent_channel,
        sent_maps_url: r.sent_maps_url,
      })));
      const taskItemIds = Array.from(new Set(subRows.map((s) => s.task_item_id))).filter(Boolean);
      type TaskItemMeta = { name: string; warehouse_item_id: string | null; qty_requested: number | null; unit_label: string | null; ecer_title_id: string | null };
      let metaByItemId = new Map<string, TaskItemMeta>();
      if (taskItemIds.length > 0) {
        const { data: tItems } = await withSupabaseQueryTimeout<SupabaseQueryResult<Array<{ id: string; name_snapshot: string | null; warehouse_item_id: string | null; qty_requested: number | null; unit_label: string | null; ecer_title_id: string | null }>>>(
          (signal) => sb
            .from("prep_task_items")
            .select("id,name_snapshot,warehouse_item_id,qty_requested,unit_label,ecer_title_id")
            .in("id", taskItemIds)
            .abortSignal(signal),
          "ready_ecer_task_items",
        );
        metaByItemId = new Map(
          ((tItems ?? []) as Array<{ id: string; name_snapshot: string | null; warehouse_item_id: string | null; qty_requested: number | null; unit_label: string | null; ecer_title_id: string | null }>).map((i) => [
            i.id,
            {
              name: (i.name_snapshot ?? "").trim().toLowerCase(),
              warehouse_item_id: i.warehouse_item_id,
              qty_requested: i.qty_requested,
              unit_label: (i.unit_label ?? "").trim().toLowerCase(),
              ecer_title_id: i.ecer_title_id,
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
      const unmatchedNames: string[] = [];
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
        // Prefer explicit ecer_title_id captured when the task was created.
        // This makes worker submissions land at the exact variant (1G/ST/SPR/GS)
        // regardless of how many units were requested vs. the title's target_grams.
        if (meta.ecer_title_id && titleIds.includes(meta.ecer_title_id)) {
          titleId = meta.ecer_title_id;
          matchKind = "strict";
        } else if (wid) {
          const strictId = titleStrict.get(`${wid}|${g}|${u}`);
          if (strictId) { titleId = strictId; matchKind = "strict"; }
          else {
            const gId = titleByWidGrams.get(`${wid}|${g}`)?.[0];
            if (gId) { titleId = gId; matchKind = "fallback_grams"; }
            // Sengaja TIDAK fallback ke wid-only: kiriman pegawai yang
            // ukuran/unit-nya tidak cocok dengan judul manapun harus jatuh
            // ke panel Request, bukan menempel di judul acak (mis. SPR 0.2g
            // ketika perintah pegawai sebenarnya 1 gram). Aturan ini
            // menyelaraskan perintah pegawai dengan panel Ecer: cocok = tempel;
            // tidak cocok = biarkan panel Request yang menangani.
          }
        }
        if (!titleId) {
          // Tidak cocok dengan judul Ecer manapun. Kiriman ini ditangani panel
          // Request; catat agar admin tahu fotonya sudah masuk, bukan hilang.
          unmatchedNames.push(meta.name || "Tanpa nama");
          continue; // require warehouse match — name-only is unreliable
        }
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
      await Promise.race([
        Promise.allSettled(thumbJobs),
        new Promise<void>((resolve) => window.setTimeout(resolve, 5_000)),
      ]);

      setUnmatched({
        count: unmatchedNames.length,
        names: Array.from(new Set(unmatchedNames)).slice(0, 5),
      });

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
    } catch (err) {
      console.warn("[ready-ecer] gagal memuat, lepas skeleton", err);
      setRows((prev) => prev ?? []);
      setRealtimeStatus("offline");
    }
  }

  useEffect(() => {
    void load();
    // Beberapa foto yang diunggah beruntun menghasilkan banyak event dalam
    // hitungan detik. Tanpa jeda, seluruh pemuatan (5 tabel + URL foto)
    // diulang untuk tiap event dan layar terasa berat.
    let bumpTimer: number | undefined;
    let bumpRunning = false;
    const runBump = async () => {
      if (bumpRunning) return;
      bumpRunning = true;
      setSyncing(true);
      try { await load(); } finally { setSyncing(false); bumpRunning = false; }
    };
    const bump = () => {
      if (bumpTimer) window.clearTimeout(bumpTimer);
      bumpTimer = window.setTimeout(() => { void runBump(); }, 700);
    };
    const ch = supabase
      .channel("ready-ecer:prep_submissions")
      .on("postgres_changes", { event: "*", schema: "public", table: "prep_submissions" }, bump)
      // H20: "siapkan sendiri" rows live in ecer_preparations — subscribe here too
      // so paket yang dibuat dari flow ecer langsung ikut refresh.
      .on("postgres_changes", { event: "*", schema: "public", table: "ecer_preparations" }, bump)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRealtimeStatus("offline");
        else setRealtimeStatus("connecting");
      });
    return () => {
      if (bumpTimer) window.clearTimeout(bumpTimer);
      supabase.removeChannel(ch);
    };
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
  // Ref ke root section supaya kita bisa scroll ke sini saat user datang
  // dari toast "Lihat Riwayat" di /ecer.
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Buka tab Riwayat + scroll ke section bila datang dari toast atau bila
  // ReadyEcerSection sudah ter-mount saat event di-dispatch.
  useEffect(() => {
    const openSent = () => {
      setView("sent");
      // Tunggu satu frame supaya konten tab Riwayat sudah render sebelum scroll.
      requestAnimationFrame(() => {
        rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };
    if (consumeSentTabFlag()) openSent();
    const handler = () => openSent();
    window.addEventListener(SHOW_SENT_EVENT, handler);
    return () => window.removeEventListener(SHOW_SENT_EVENT, handler);
  }, []);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<null | "delete">(null);
  const [bulkPickChat, setBulkPickChat] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<null | "wa" | "chat" | "delete">(null);
  const [layout, setLayout] = useLayoutMode("readyEcer", "grid");
  const ecerGridClass = layoutGridClass(layout);
  // Reset pilihan jika tab/view berganti.
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, [view]);
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const sentMap = useSentShots();
  const sentDetails = useSentDetails();
  // Kartu yang di-"Hapus dari Riwayat" — dikecualikan dari daftar Aktif
  // maupun Riwayat sampai user meng-unhide (misalnya lewat clear registry).
  const hiddenSet = useHiddenSent();
  // Split each row's shots into active vs sent based on local history.
  const rowsForView = (filtered ?? []).map((r) => {
    const active: WorkerShot[] = [];
    const sent: WorkerShot[] = [];
    for (const s of r.worker_shots) {
      if (hiddenSet.has(s.id)) continue;
      (sentMap.has(s.id) ? sent : active).push(s);
    }
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
  // ------------------------------------------------------------------
  // Highlight kartu yang BARU dipindah ke Riwayat. Alur:
  //   1. Deteksi sentinel `max(sentMap.at)` bertambah dibanding baseline
  //      saat komponen mount → berarti ada shot yang baru saja ditandai
  //      terkirim (baik dari toast /ecer, tombol WhatsApp, atau tab lain).
  //   2. Temukan row (Judul Ecer) yang memiliki shot tersebut.
  //   3. Kalau user belum di tab "Riwayat terkirim", buka tab-nya dulu
  //      (pending), lalu ketika view === "sent" — set justMovedRowId
  //      supaya kartu scroll ke tengah viewport + ring emerald.
  //   4. Highlight auto-hilang setelah 2.6 detik.
  // ------------------------------------------------------------------
  const initialMaxAtRef = useRef<number | null>(null);
  const [justMovedRowId, setJustMovedRowId] = useState<string | null>(null);
  const [pendingHighlightRowId, setPendingHighlightRowId] = useState<string | null>(null);
  useEffect(() => {
    let maxAt = 0;
    let newestId: string | null = null;
    for (const [id, at] of sentMap) {
      if (at > maxAt) { maxAt = at; newestId = id; }
    }
    if (initialMaxAtRef.current === null) {
      initialMaxAtRef.current = maxAt;
      return;
    }
    if (maxAt <= initialMaxAtRef.current) return;
    initialMaxAtRef.current = maxAt;
    if (!newestId) return;
    const rowsAll = filtered ?? [];
    const row = rowsAll.find((r) => r.worker_shots.some((s) => s.id === newestId));
    if (!row) return;
    if (view === "sent") {
      setJustMovedRowId(row.id);
    } else {
      setPendingHighlightRowId(row.id);
      setView("sent");
      requestAnimationFrame(() => {
        rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [sentMap, filtered, view]);
  useEffect(() => {
    if (view === "sent" && pendingHighlightRowId) {
      setJustMovedRowId(pendingHighlightRowId);
      setPendingHighlightRowId(null);
    }
  }, [view, pendingHighlightRowId]);
  useEffect(() => {
    if (!justMovedRowId) return;
    const t = setTimeout(() => setJustMovedRowId(null), 2600);
    return () => clearTimeout(t);
  }, [justMovedRowId]);
  const syncCounts = (rows ?? []).reduce<Record<SyncLevel, number>>((acc, r) => {
    acc[r.sync.level] = (acc[r.sync.level] ?? 0) + 1;
    return acc;
  }, { ok: 0, fallback_grams: 0, fallback_wid: 0, self_only: 0, no_match: 0, no_wid: 0, empty: 0 });
  const visible = rowsAfterView.filter((r) => syncFilter === "all" || r.sync.level === syncFilter);

  function formatAbsolute(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  return (
    <div ref={rootRef} className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-ms-1.5">
          <p className="text-ms-2xs uppercase tracking-wide text-muted-foreground">
            Produk Eceran Siap Kirim
          </p>
          <RealtimeBadge status={realtimeStatus} syncing={syncing || refreshing} />
        </div>
        <Link to="/ecer" search={{ item: undefined, title: undefined, highlight: undefined, send: undefined }} className="inline-flex items-center gap-0.5 text-ms-2xs font-medium text-primary hover:underline">
          Buka semua <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      {/* Layout toggle (grid/list/table) — desktop only. Di mobile user
          harian cukup dengan satu layout list yang paling jelas. */}
      <div className="hidden justify-end sm:flex">
        <LayoutModeToggle mode={layout} onChange={setLayout} />
      </div>

      {rows && rows.length > 0 && (
        <div className="flex gap-ms-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari judul, produk, kategori (1g, ST, SPR, GS), atau ID…"
              className="h-8 w-full rounded-md border bg-card pl-7 pr-7 text-ms-xs outline-none placeholder:text-muted-foreground focus:border-primary/40"
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
            className="h-8 max-w-[40%] rounded-md border bg-card px-ms-2 text-ms-xs outline-none focus:border-primary/40"
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
          className={`flex items-center justify-between gap-ms-2 rounded-md border px-ms-2 py-1 text-ms-2xs transition-colors ${
            crossTabSync.status === "pending"
              ? "border-warning/30 bg-warning/10 text-warning dark:text-warning"
              : "border-success/30 bg-success/10 text-success dark:text-success"
          }`}
        >
          <div className="flex min-w-0 items-center gap-ms-2">
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
        <div className="flex items-center justify-between gap-ms-2 rounded-md border border-primary/30 bg-primary/5 px-ms-2 py-1 text-ms-2xs text-primary">
          <div className="flex min-w-0 flex-1 items-center gap-ms-2">
            <span className="truncate">
              Disinkron dari detail: {(products.find(([id]) => id === productFilter)?.[1]) ?? "produk terpilih"}
            </span>
            {lastSyncedAt && (
              <time
                dateTime={new Date(lastSyncedAt).toISOString()}
                title={new Date(lastSyncedAt).toLocaleString()}
                className="shrink-0 tabular-nums opacity-70"
              >
                · {fmtAgo(lastSyncedAt, nowTick)}
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
        <div className="flex items-center gap-ms-1 rounded-md border bg-card/50 p-0.5">
          <button
            type="button"
            onClick={() => setView("active")}
            className={`flex-1 rounded px-ms-2 py-1 text-ms-2xs font-semibold transition ${view === "active" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent"}`}
            aria-pressed={view === "active"}
          >
            Aktif <span className="ml-1 font-mono opacity-80">{totalActive}</span>
          </button>
          <button
            type="button"
            onClick={() => setView("sent")}
            className={`flex-1 inline-flex items-center justify-center gap-ms-1 rounded px-ms-2 py-1 text-ms-2xs font-semibold transition ${view === "sent" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent"}`}
            aria-pressed={view === "sent"}
          >
            <History className="h-3 w-3" /> Riwayat terkirim <span className="ml-0.5 font-mono opacity-80">{totalSent}</span>
          </button>
        </div>
      )}

      {rows && rows.length > 0 && visible.length > 0 && (
        <div className="hidden sm:block">
        <BulkToolbar
          selectMode={selectMode}
          setSelectMode={(v) => { setSelectMode(v); if (!v) setSelectedIds(new Set()); }}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          visibleIds={visible.map((r) => r.id)}
          view={view}
          busy={bulkBusy}
          onBulkWA={async () => {
            if (selectedIds.size === 0) return;
            // WA/Chat bulk lama mengirim langsung tanpa lewat verifikasi
            // pembayaran. Sekarang disamakan dengan alur Siapkan Sendiri &
            // tombol per-kartu: WAJIB satu judul, lalu diarahkan ke /ecer
            // dengan `send=1` supaya SendEcerPrepsDialog terbuka dan owner
            // mengisi metode bayar sebelum WA benar-benar terkirim.
            if (selectedIds.size > 1) {
              toast.info("Verifikasi bayar hanya bisa satu judul sekaligus agar pencatatan penjualan tetap eksplisit.");
              return;
            }
            const id = [...selectedIds][0];
            const row = (rows ?? []).find((r) => r.id === id);
            if (!row) return;
            setSelectedIds(new Set());
            setSelectMode(false);
            void navigate({
              to: "/ecer",
              search: { item: row.warehouse_item_id, title: row.id, highlight: undefined, send: "1" },
            });
          }}
          onBulkChatPick={() => {
            if (selectedIds.size === 0) return;
            if (selectedIds.size > 1) {
              toast.info("Verifikasi bayar hanya bisa satu judul sekaligus agar pencatatan penjualan tetap eksplisit.");
              return;
            }
            const id = [...selectedIds][0];
            const row = (rows ?? []).find((r) => r.id === id);
            if (!row) return;
            setSelectedIds(new Set());
            setSelectMode(false);
            void navigate({
              to: "/ecer",
              search: { item: row.warehouse_item_id, title: row.id, highlight: undefined, send: "1" },
            });
          }}
          onBulkDelete={() => setBulkConfirm("delete")}
        />
        </div>
      )}

      <PickChatConversationDialog
        open={bulkPickChat}
        onOpenChange={setBulkPickChat}
        onPick={async (cid, ctitle) => {
          setBulkPickChat(false);
          if (selectedIds.size === 0) return;
          setBulkBusy("chat");
          try {
            const ids = [...selectedIds];
            for (const id of ids) {
              await new Promise<void>((resolve) => {
                const handler = () => { window.removeEventListener(`ecer-bulk-done:${id}`, handler); resolve(); };
                window.addEventListener(`ecer-bulk-done:${id}`, handler);
                window.dispatchEvent(new CustomEvent(`ecer-bulk:chat:${id}`, { detail: { conversationId: cid, conversationTitle: ctitle } }));
                setTimeout(() => { window.removeEventListener(`ecer-bulk-done:${id}`, handler); resolve(); }, 60000);
              });
            }
          } finally {
            setBulkBusy(null);
            setSelectedIds(new Set());
            setSelectMode(false);
          }
        }}
        title={`Kirim ${selectedIds.size} kartu ke percakapan`}
      />

      <AlertDialog open={bulkConfirm === "delete"} onOpenChange={(o) => !o && setBulkConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Hapus {selectedIds.size} kartu dari {view === "sent" ? "Riwayat terkirim" : "daftar aktif"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {view === "sent"
                ? "Riwayat lokal kartu yang dipilih akan dibersihkan. Foto pegawai tetap ada — kartu akan kembali ke daftar Aktif."
                : "Kartu terpilih akan ditandai terkirim (dilewati) tanpa mengirim ke WA atau Chat. Anda bisa mengembalikannya dari tab Riwayat terkirim."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (selectedIds.size === 0) { setBulkConfirm(null); return; }
                setBulkBusy("delete");
                try {
                  const ids = [...selectedIds];
                  for (const id of ids) {
                    window.dispatchEvent(new CustomEvent(`ecer-bulk:${view === "sent" ? "undo" : "skip"}:${id}`));
                  }
                } finally {
                  setBulkBusy(null);
                  setSelectedIds(new Set());
                  setSelectMode(false);
                  setBulkConfirm(null);
                }
              }}
            >
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {rows === null ? (
        <div className={ecerGridClass} aria-busy="true" aria-label="Memuat produk eceran">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-ms-1 rounded-md border bg-card px-ms-3 py-ms-2.5">
              <div className="flex items-center gap-ms-1.5">
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
          search={{ item: undefined, title: undefined, highlight: undefined, send: undefined }}
          className="flex flex-col items-center gap-ms-1.5 rounded-md border border-dashed bg-card/50 p-ms-5 text-center text-ms-2xs text-muted-foreground hover:border-primary/40 hover:bg-accent"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <Scale className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium text-foreground">Belum ada Judul Ecer</span>
          <span>Tap untuk membuat yang pertama.</span>
          <span className="mt-0.5 inline-flex items-center gap-ms-1 rounded-full bg-primary/10 px-ms-2 py-0.5 text-primary">
            <Plus className="h-3 w-3" /> Buat sekarang
          </span>
        </Link>
      ) : filtered && filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-ms-2 rounded-md border border-dashed bg-card/50 p-ms-4 text-center text-ms-2xs text-muted-foreground">
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
        <div className={ecerGridClass}>
          {visible.length === 0 ? (
            <div className="col-span-full flex flex-col items-center gap-ms-1 rounded-md border border-dashed bg-card/50 p-ms-5 text-center text-ms-2xs text-muted-foreground">
              {view === "sent" ? (
                <>
                  <History className="h-4 w-4" />
                  <span>Belum ada riwayat terkirim. Tekan tombol WhatsApp pada kartu aktif — kiriman akan pindah ke sini.</span>
                </>
              ) : (
                <span>Semua kartu sudah dipindah ke Riwayat terkirim.</span>
              )}
            </div>
          ) : (
            visible.map((r) => (
              <EcerCard
                key={r.id}
                row={r}
                onRefresh={handleRefresh}
                refreshing={refreshing}
                syncing={syncing}
                realtimeStatus={realtimeStatus}
                view={view}
                lastSentAt={r._lastSentAt}
                sentDetails={sentDetails}
                now={nowTick}
                selectMode={selectMode}
                selected={selectedIds.has(r.id)}
                justMoved={justMovedRowId === r.id}
                onToggleSelect={() => toggleSelect(r.id)}
                onEnterSelect={() => {
                  setSelectMode(true);
                  setSelectedIds(new Set([r.id]));
                }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BulkToolbar({
  selectMode, setSelectMode, selectedIds, setSelectedIds, visibleIds, view, busy,
  onBulkWA, onBulkChatPick, onBulkDelete,
}: {
  selectMode: boolean;
  setSelectMode: (v: boolean) => void;
  selectedIds: Set<string>;
  setSelectedIds: (s: Set<string>) => void;
  visibleIds: string[];
  view: "active" | "sent";
  busy: null | "wa" | "chat" | "delete";
  onBulkWA: () => void;
  onBulkChatPick: () => void;
  onBulkDelete: () => void;
}) {
  const allSelected = selectMode && visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const count = selectedIds.size;
  if (!selectMode) {
    return (
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setSelectMode(true)}
          className="inline-flex h-7 items-center gap-ms-1 rounded-md border bg-card px-ms-2 text-ms-2xs font-semibold text-foreground hover:bg-accent"
        >
          <ListChecks className="h-3 w-3" /> Pilih beberapa
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-ms-1 rounded-md border bg-primary/5 px-1.5 py-1">
      <button
        type="button"
        onClick={() => {
          if (allSelected) setSelectedIds(new Set());
          else setSelectedIds(new Set(visibleIds));
        }}
        className="inline-flex h-7 items-center gap-ms-1 rounded-md bg-card px-ms-2 text-ms-2xs font-semibold hover:bg-accent"
      >
        {allSelected ? <CheckSquare className="h-3 w-3 text-primary" /> : <Square className="h-3 w-3" />}
        {allSelected ? "Lepas semua" : "Pilih semua"}
      </button>
      <span className="text-ms-2xs font-semibold text-primary">{count} terpilih</span>
      <div className="ml-auto flex flex-wrap items-center gap-ms-1">
        <WaShareButton
          size="sm"
          variant="solid"
          disabled={count === 0 || busy !== null}
          busy={busy === "wa"}
          reason={count === 0 ? "Pilih minimal 1 kartu dulu" : undefined}
          onClick={onBulkWA}
        />
        <ChatShareButton
          size="sm"
          variant="solid"
          disabled={count === 0 || busy !== null}
          busy={busy === "chat"}
          reason={count === 0 ? "Pilih minimal 1 kartu dulu" : undefined}
          onClick={onBulkChatPick}
        />
        <button
          type="button"
          onClick={onBulkDelete}
          disabled={count === 0 || busy !== null}
          className="inline-flex h-7 items-center gap-ms-1 rounded-md border border-destructive/40 bg-destructive/10 px-ms-2 text-ms-2xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
        >
          {busy === "delete" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          Hapus
        </button>
        <button
          type="button"
          onClick={() => setSelectMode(false)}
          disabled={busy !== null}
          className="inline-flex h-7 items-center gap-ms-1 rounded-md border bg-card px-ms-2 text-ms-2xs font-semibold text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          <X className="h-3 w-3" /> Batal
        </button>
      </div>
      <p className="basis-full text-ms-2xs text-muted-foreground">
        {view === "sent"
          ? "Tap kartu untuk centang. Aksi WA/Chat akan mengirim ulang; Hapus akan mengembalikan ke Aktif."
          : "Tap kartu untuk centang. WA/Chat memproses tiap kartu berurutan; Hapus menandai sebagai dilewati."}
      </p>
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
    <div className="rounded-md border bg-card/50 p-ms-1.5">
      <div className="mb-1 flex items-center justify-between px-0.5">
        <span className="text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">Status sinkron</span>
        {failing > 0 && (
          <span className="text-ms-2xs font-semibold text-destructive">{failing} gagal</span>
        )}
      </div>
      <div className="flex flex-wrap gap-ms-1">
        <button
          type="button"
          onClick={() => onChange("all")}
          className={`inline-flex items-center gap-ms-1 rounded-full px-1.5 py-0.5 text-ms-2xs font-semibold ${active === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
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
              className={`inline-flex items-center gap-ms-1 rounded-full px-1.5 py-0.5 text-ms-2xs font-semibold ${meta.cls} ${isActive ? "ring-2 ring-primary/40" : ""}`}
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
      <span className="inline-flex h-5 shrink-0 items-center gap-ms-1 whitespace-nowrap rounded-full bg-primary/10 px-1.5 text-ms-2xs font-medium leading-none text-primary">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Memperbarui…
      </span>
    );
  }
  if (status === "live") {
    return (
      <span className="inline-flex h-5 shrink-0 items-center gap-ms-1 whitespace-nowrap rounded-full bg-success/10 px-1.5 text-ms-2xs font-medium leading-none text-success dark:text-success">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
        </span>
        Live
      </span>
    );
  }
  if (status === "offline") {
    return (
      <span className="inline-flex h-5 shrink-0 items-center gap-ms-1 whitespace-nowrap rounded-full bg-destructive/10 px-1.5 text-ms-2xs font-medium leading-none text-destructive">
        <Radio className="h-2.5 w-2.5" /> Offline
      </span>
    );
  }
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-ms-1 whitespace-nowrap rounded-full bg-muted px-1.5 text-ms-2xs font-medium leading-none text-muted-foreground">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Menyambung…
    </span>
  );
}

type EcerCardProps = {
  row: Row;
  onRefresh: () => void;
  refreshing: boolean;
  syncing: boolean;
  realtimeStatus: "connecting" | "live" | "offline";
  view: "active" | "sent";
  lastSentAt: number | null;
  sentDetails: Map<string, SentEntry>;
  now: number;
  selectMode?: boolean;
  selected?: boolean;
  justMoved?: boolean;
  onToggleSelect?: () => void;
  onEnterSelect?: () => void;
};
function EcerCard(props: EcerCardProps) {
  return <EcerCardImpl {...props} />;
}

const SYNC_META: Record<SyncLevel, { label: string; cls: string; dot: string }> = {
  ok:              { label: "Tersinkron",        cls: "bg-success/10 text-success dark:text-success", dot: "bg-success" },
  fallback_grams:  { label: "Cocok ukuran",      cls: "bg-warning/10 text-warning dark:text-warning",       dot: "bg-warning" },
  fallback_wid:    { label: "Cocok produk",      cls: "bg-warning/10 text-warning dark:text-warning",       dot: "bg-warning" },
  self_only:       { label: "Mandiri saja",      cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400",             dot: "bg-sky-500" },
  no_match:        { label: "Tidak cocok",       cls: "bg-destructive/10 text-destructive",                       dot: "bg-destructive" },
  no_wid:          { label: "Tanpa produk",      cls: "bg-destructive/10 text-destructive",                       dot: "bg-destructive" },
  empty:           { label: "Belum ada data",    cls: "bg-muted text-muted-foreground",                           dot: "bg-muted-foreground" },
};

/**
 * Format timestamp relatif ("Terkirim · N mnt lalu") dengan pembulatan
 * kanonik ala WhatsApp / Twitter:
 *   - Clock skew (ts di masa depan) → "baru saja".
 *   - < 10 dtk           → "baru saja"
 *   - < 60 dtk           → "N dtk lalu"       (floor: 59.9s → 59)
 *   - < 60 mnt           → "N mnt lalu"       (floor pada menit penuh)
 *   - < 24 jam           → "N jam lalu"
 *   - < 7 hari           → "N hari lalu"
 *   - ≥ 7 hari           → tanggal absolut ("12 Jul 2026")
 * Menerima `now` eksplisit supaya SEMUA badge di satu render pakai
 * referensi waktu yang sama (konsistensi antar-item).
 */
function fmtAgo(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 10_000) return "baru saja"; // termasuk clock skew (diff < 0)
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} dtk lalu`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} mnt lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} hari lalu`;
  return new Date(ts).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function SendStatusBadge({ status, error, view, lastSentAt, sentCount, now, onResend, resendLabel }: {
  status: "idle" | "sending" | "success" | "failed" | "cancelled";
  error: string | null;
  view: "active" | "sent";
  lastSentAt: number | null;
  sentCount: number;
  now: number;
  onResend?: () => void;
  resendLabel?: string;
}) {
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  if (status === "sending") {
    return (
      <span onClick={stop} className="inline-flex w-fit items-center gap-ms-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-ms-2xs font-semibold text-primary">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Mengirim…
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-ms-1">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" onClick={stop} className="inline-flex w-fit items-center gap-ms-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-ms-2xs font-semibold text-destructive">
            <XCircle className="h-2.5 w-2.5" /> Gagal kirim
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-1 p-ms-2.5 text-ms-2xs" onClick={stop}>
          <div className="font-semibold text-foreground">Gagal kirim via WhatsApp</div>
          <p className="text-muted-foreground break-words">{error || "Penyebab tidak diketahui."}</p>
          {onResend ? (
            <button
              type="button"
              onClick={(e) => { stop(e); onResend(); }}
              className="mt-1 inline-flex w-full items-center justify-center gap-ms-1 rounded-md bg-primary px-ms-2 py-1 text-ms-2xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="h-3 w-3" /> {resendLabel || "Kirim ulang"}
            </button>
          ) : (
            <p className="text-muted-foreground">Tekan tombol WhatsApp lagi untuk mencoba ulang.</p>
          )}
        </PopoverContent>
      </Popover>
      {onResend && (
        <button
          type="button"
          onClick={(e) => { stop(e); onResend(); }}
          className="inline-flex items-center gap-ms-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-ms-2xs font-semibold text-primary hover:bg-primary/20"
          title={resendLabel || "Kirim ulang"}
        >
          <RefreshCw className="h-2.5 w-2.5" /> Kirim ulang
        </button>
      )}
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span onClick={stop} className="inline-flex w-fit items-center gap-ms-1 rounded-full bg-muted px-1.5 py-0.5 text-ms-2xs font-semibold text-muted-foreground">
        <CircleSlash className="h-2.5 w-2.5" /> Dibatalkan
      </span>
    );
  }
  if (status === "success" || (view === "sent" && lastSentAt)) {
    const label = status === "success" ? "Sukses dikirim" : `Terkirim · ${fmtAgo(lastSentAt!, now)}`;
    return (
      <span onClick={stop} className="inline-flex w-fit items-center gap-ms-1 rounded-full bg-success/10 px-1.5 py-0.5 text-ms-2xs font-semibold text-success dark:text-success" title={lastSentAt ? new Date(lastSentAt).toLocaleString() : undefined}>
        <CheckCircle2 className="h-2.5 w-2.5" /> {label}
      </span>
    );
  }
  if (view === "active" && sentCount === 0) {
    return (
      <span onClick={stop} className="inline-flex w-fit items-center gap-ms-1 rounded-full bg-muted px-1.5 py-0.5 text-ms-2xs font-medium text-muted-foreground">
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
    <div className="rounded-md border bg-muted/40 p-ms-1.5">
      <div className="mb-1 flex items-center gap-ms-1 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
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
            <li key={shot.id} className="flex flex-wrap items-center gap-ms-1 text-ms-2xs leading-snug">
              <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${channel === "chat" ? "bg-primary/10 text-primary" : "bg-success/10 text-success dark:text-success"}`}>
                {channel === "chat" ? <Send className="h-2.5 w-2.5" /> : <MessageCircle className="h-2.5 w-2.5" />}
                {channel === "chat" ? "Chat" : "WA"}
              </span>
              <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${ok ? "bg-success/10 text-success dark:text-success" : "bg-destructive/10 text-destructive"}`}>
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
          className={`inline-flex w-fit items-center gap-ms-1 rounded-full px-1.5 py-0.5 text-ms-2xs font-semibold ${meta.cls}`}
          aria-label={`Status sinkron: ${meta.label}`}
        >
          <span className={`h-1 w-1 rounded-full ${meta.dot}`} />
          {meta.label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 space-ms-2 p-ms-2.5 text-ms-2xs"
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

function EcerCardImpl({ row: r, onRefresh, refreshing, syncing, realtimeStatus, view, lastSentAt, sentDetails, now, selectMode = false, selected = false, justMoved = false, onToggleSelect, onEnterSelect }: EcerCardProps) {
  const cardRootRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const openCardDetail = () => {
    void navigate({
      to: "/ecer",
      search: { item: r.warehouse_item_id, title: r.id, highlight: undefined, send: undefined },
    });
  };
  // Di tab "Riwayat terkirim": tap kartu HANYA expand/collapse detail
  // pengiriman di dalam kartu. Tidak pernah pindah ke /ecer supaya user
  // bisa memeriksa riwayat tanpa keluar dari halaman index.
  const handleCardOpen = () => {
    if (view === "sent") {
      setExpanded((v) => !v);
    } else {
      openCardDetail();
    }
  };
  useEffect(() => {
    if (justMoved && cardRootRef.current) {
      // Delay 1 frame supaya layout tab "Riwayat" sudah selesai render.
      requestAnimationFrame(() => {
        cardRootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [justMoved]);
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  function startLongPress() {
    if (selectMode) return;
    longPressFired.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      try { navigator.vibrate?.(30); } catch { /* noop */ }
      setMenuOpen(true);
    }, 500);
  }
  function cancelLongPress() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }
  function doDelete() {
    if (shots.length > 0) {
      if (view === "sent") {
        unmarkSent(shots.map((s) => s.id));
        toast.success("Kartu dikembalikan ke daftar aktif.");
      } else {
        markSent(shots.map((s) => s.id), {
          channel: "wa",
          mapsUrl: null,
          status: "success",
          idemKey: `manual-skip-${r.id}-${Date.now()}`,
        });
        toast.success("Kartu ditandai terkirim & dipindah ke Riwayat.");
      }
    } else {
      toast.info("Belum ada kiriman pegawai untuk kartu ini.");
    }
    setConfirmDelete(false);
  }
  type SendStatus = "idle" | "sending" | "success" | "failed" | "cancelled";
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [waPreviewOpen, setWaPreviewOpen] = useState(false);
  const [waPreviewText, setWaPreviewText] = useState("");
  const [waPreviewLocation, setWaPreviewLocation] = useState<string | null>(null);
  const [waPreviewPhotoCount, setWaPreviewPhotoCount] = useState(0);
  // Ringkasan pengelompokan atomik per folder untuk ditampilkan di pratinjau.
  const [waPreviewFolders, setWaPreviewFolders] = useState<
    Array<{ label: string; count: number; included: boolean }>
  >([]);
  // Snapshot ekspektasi (folder ids + jumlah foto) yang dihitung saat pratinjau
  // dibuka. Dipakai sebagai gerbang validasi tepat sebelum kirim WA agar
  // pratinjau dan pesan yang benar-benar terkirim TIDAK PERNAH beda —
  // bila `shots` berubah antara klik "Pratinjau" dan "Kirim WA", alur kirim
  // dibatalkan dan operator diminta membuka pratinjau ulang.
  const [waPreviewExpected, setWaPreviewExpected] = useState<
    { folderIds: string[]; photoCount: number } | null
  >(null);
  // Ingat kanal terakhir yang dipakai untuk kirim, supaya tombol "Kirim ulang"
  // di badge Gagal bisa memicu alur yang sama tanpa harus menandai ulang.
  const [lastSendChannel, setLastSendChannel] = useState<"wa" | "chat" | null>(null);
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

  async function sendWA(
    e: React.MouseEvent,
    expected?: { folderIds: string[]; photoCount: number } | null,
  ) {
    e.preventDefault();
    e.stopPropagation();
    if (sending) return;
    if (shots.length === 0) {
      toast.info("Belum ada kiriman pegawai untuk judul ini.");
      return;
    }
    setLastSendChannel("wa");
    // Urutan kanonik: sort by id (naik) sebelum slice — sehingga urutan
    // shots di UI (yang bisa berubah karena pegawai baru menyerobot masuk
    // atau resort submitted_at) tidak mempengaruhi identitas idempotency
    // maupun urutan foto/teks yang dikirim.
    const canonicalShots = [...shots].sort((a, b) => a.id.localeCompare(b.id));
    const take = canonicalShots.slice(0, 6);
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
      // Bangun daftar slot foto secara ATOMIK per folder kiriman: setiap shot
      // (satu folder kiriman pegawai) dikirim utuh — semua foto di folder itu
      // ikut, atau folder tsb tidak ikut sama sekali. Ini menjaga janji
      // "1 folder = 1 kiriman", walau operator menandai beberapa foto atau
      // slicing 10 memotong di tengah folder. Pertahankan slot yang gagal
      // agar bisa di-retry dari pratinjau tanpa mengulang alur kirim.
      type Slot = { path: string; name: string; source: typeof take[number]["source"] };
      const folderGroups: Array<{ shot: typeof take[number]; slots: Slot[] }> = [];
      for (const s of take) {
        const paths = Array.from(new Set([
          ...((s.photo_paths ?? []) as string[]),
          ...(s.photo_path ? [s.photo_path] : []),
        ])).filter(Boolean).sort();
        if (paths.length === 0) continue;
        const group: Slot[] = paths.map((p, pi) => ({
          path: p,
          name: `${r.name}-${s.id.slice(0, 6)}-${pi + 1}.jpg`,
          source: s.source,
        }));
        folderGroups.push({ shot: s, slots: group });
      }
      const MAX_SLOTS = 10;
      const freshSlots: Slot[] = [];
      const includedShots: typeof take = [];
      for (const g of folderGroups) {
        // Selalu sertakan folder pertama secara utuh, bahkan bila jumlah foto
        // > MAX_SLOTS — supaya kiriman tidak terpotong di tengah folder.
        if (freshSlots.length === 0) {
          freshSlots.push(...g.slots); includedShots.push(g.shot); continue;
        }
        if (freshSlots.length + g.slots.length > MAX_SLOTS) break;
        freshSlots.push(...g.slots); includedShots.push(g.shot);
      }
      // Judul & daftar item HARUS mencerminkan folder yang benar-benar ikut
      // dikirim, bukan `take` mentah — supaya hitungan "kiriman" dan daftar
      // foto di pesan WA konsisten dengan lampiran.
      const folderName = (s: typeof take[number]) =>
        s.source === "self" ? "Siapkan sendiri" : (s.item_name || r.name || `Kiriman ${s.id.slice(0, 6)}`);
      // Gerbang validasi: bila pratinjau menyertakan snapshot ekspektasi,
      // pastikan folder yang benar-benar akan terkirim (id + jumlah foto)
      // SAMA PERSIS dengan yang ditampilkan di pratinjau. Kalau tidak,
      // batalkan sebelum share sheet terbuka dan minta operator membuka
      // pratinjau ulang — mencegah mismatch pratinjau vs pesan terkirim.
      if (expected) {
        const actualIds = [...includedShots.map((s) => s.id)].sort();
        const idsMatch =
          actualIds.length === expected.folderIds.length &&
          actualIds.every((id, i) => id === expected.folderIds[i]);
        const countMatch = freshSlots.length === expected.photoCount;
        if (!idsMatch || !countMatch) {
          toast.warning(
            `Kiriman berubah sejak pratinjau (folder ${expected.folderIds.length}→${actualIds.length}, foto ${expected.photoCount}→${freshSlots.length}). Buka pratinjau ulang.`,
          );
          setSending(false);
          setSendStatus("idle");
          return;
        }
      }
      const lines = includedShots.map((s) => `• ${folderName(s)} — ${new Date(s.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`);
      const firstLocationFresh = includedShots.find((s) => s.location_url)?.location_url ?? null;
      const omitted = shots.length - includedShots.length;
      const freshText = [
        `*${r.name}* (${r.product_name} · ${r.target_grams} ${unit})`,
        `${shots.length} kiriman pegawai${omitted > 0 ? ` (mengirim ${includedShots.length})` : ""} · ${freshSlots.length} foto terlampir:`,
        ...lines,
        ...(firstLocationFresh ? [``, `📍 Lokasi: ${firstLocationFresh}`] : []),
      ].join("\n");
      const freshFingerprint = payloadFingerprint({
        channel: "wa",
        text: freshText,
        url: firstLocationFresh ?? null,
        expectedCount: freshSlots.length,
        slots: freshSlots.map((s) => ({ path: s.path, name: s.name })),
      });
      // Snapshot idempoten — pengiriman kedua/ketiga menggunakan urutan &
      // teks yang persis sama seperti pengiriman pertama, walaupun `shots`
      // di UI sudah berubah di antara klik.
      const snapshot = await getOrCreateSendSnapshot(idemKey, async () => ({
        fingerprint: freshFingerprint,
        orderedIds: take.map((s) => s.id),
        text: freshText,
        locationUrl: firstLocationFresh ?? null,
        slotFileNames: freshSlots.map((s) => s.name),
        slotPaths: freshSlots.map((s) => s.path),
        expectedCount: freshSlots.length,
        meta: { destination: r.name },
      }));
      // Rekonstruksi slots dari snapshot supaya path/nama/order = kali pertama.
      // `source` diambil dari take saat ini bila cocok, fallback ke shot pertama.
      const idToSource = new Map(canonicalShots.map((s) => [s.id, s.source]));
      const slots: Slot[] = snapshot.slotPaths.map((p, i) => {
        const name = snapshot.slotFileNames[i] ?? `${r.name}-${i + 1}.jpg`;
        const ownerId = snapshot.orderedIds.find((id) => name.includes(id.slice(0, 6)));
        const source = (ownerId && idToSource.get(ownerId)) || take[0]?.source || "worker";
        return { path: p, name, source };
      });
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
      // Peringatan detail: jelaskan foto mana yang gagal dibaca dari bucket
      // agar operator tahu folder + urutan foto yang tidak ikut terlampir.
      const describeFailedSlot = (sl: Slot) => {
        const ownerId = snapshot.orderedIds.find((id) => sl.name.includes(id.slice(0, 6)));
        const owner = includedShots.find((s) => s.id === ownerId) ?? take.find((s) => s.id === ownerId);
        const label = owner ? folderName(owner) : (ownerId ? `Kiriman ${ownerId.slice(0, 6)}` : "Kiriman");
        const idx = sl.name.match(/-(\d+)\.jpg$/)?.[1] ?? "?";
        return `${label} · foto #${idx}`;
      };
      if (initial.failed.length > 0) {
        const details = initial.failed.map(describeFailedSlot);
        const preview = details.slice(0, 4).join(", ");
        const more = details.length > 4 ? ` (+${details.length - 4} lagi)` : "";
        const msg = files.length === 0
          ? `Semua ${initial.failed.length} foto gagal dibaca: ${preview}${more}`
          : `${initial.failed.length}/${expectedCount} foto gagal dibaca: ${preview}${more}`;
        toast.warning(msg, {
          description: "Bisa dicoba ulang dari tombol Kirim ulang setelah share sheet muncul.",
        });
        appendSendLog(idemKey, { kind: "error", label: `Foto gagal dibaca (${initial.failed.length}/${expectedCount})`, detail: details.join(" · ") });
      }
      // Payload TETAP diambil dari snapshot — pengiriman kedua/ketiga wajib
      // menghasilkan teks, urutan foto, dan link lokasi yang identik dengan
      // pengiriman pertama.
      const text = snapshot.text;
      const firstLocation = snapshot.locationUrl;
      const waFingerprint = snapshot.fingerprint;
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
          // Pindah ke Riwayat terkirim SATU entri per folder yang benar-benar
          // ikut (includedShots), bukan `take` mentah — supaya folder yang
          // dilewati batas 10 foto tidak salah-tandai sebagai terkirim.
          markSent(includedShots.map((s) => s.id), { channel: "wa", mapsUrl: firstLocation, status: "success", idemKey });
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
            // Idem: hanya folder yang benar-benar ikut yang pindah ke Riwayat.
            markSent(includedShots.map((s) => s.id), { channel: "wa", mapsUrl: firstLocation, status: "success", idemKey });
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

  function openWAPreview(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (sending) return;
    if (shots.length === 0) {
      toast.info("Belum ada kiriman pegawai untuk judul ini.");
      return;
    }
    const canonicalShots = [...shots].sort((a, b) => a.id.localeCompare(b.id));
    const take = canonicalShots.slice(0, 6);
    // Cerminkan logika atomik-per-folder yang sama dengan sendWA agar
    // hitungan "kiriman" & daftar item di pratinjau selalu = yang benar-
    // benar akan terkirim.
    const MAX_SLOTS = 10;
    const folderGroups: Array<{ shot: typeof take[number]; count: number }> = [];
    for (const s of take) {
      const paths = new Set<string>([
        ...((s.photo_paths ?? []) as string[]),
        ...(s.photo_path ? [s.photo_path] : []),
      ]);
      const n = Array.from(paths).filter(Boolean).length;
      if (n > 0) folderGroups.push({ shot: s, count: n });
    }
    const includedShots: typeof take = [];
    let photoCount = 0;
    for (const g of folderGroups) {
      if (photoCount === 0) { photoCount += g.count; includedShots.push(g.shot); continue; }
      if (photoCount + g.count > MAX_SLOTS) break;
      photoCount += g.count; includedShots.push(g.shot);
    }
    // Ringkasan folder untuk pratinjau: tandai mana yang ikut / tidak.
    const includedIds = new Set(includedShots.map((s) => s.id));
    const folderName = (s: typeof take[number]) =>
      s.source === "self" ? "Siapkan sendiri" : (s.item_name || r.name || `Kiriman ${s.id.slice(0, 6)}`);
    const folderSummary = folderGroups.map((g, i) => ({
      label: `Folder ${i + 1}: ${folderName(g.shot)} · ${new Date(g.shot.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`,
      count: g.count,
      included: includedIds.has(g.shot.id),
    }));
    const lines = includedShots.map((s) => `• ${folderName(s)} — ${new Date(s.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`);
    const firstLocation = includedShots.find((s) => s.location_url)?.location_url ?? null;
    const omitted = shots.length - includedShots.length;
    const text = [
      `*${r.name}* (${r.product_name} · ${r.target_grams} ${unit})`,
      `${shots.length} kiriman pegawai${omitted > 0 ? ` (mengirim ${includedShots.length})` : ""} · ${photoCount} foto terlampir:`,
      ...lines,
      ...(firstLocation ? [``, `📍 Lokasi: ${firstLocation}`] : []),
    ].join("\n");
    setWaPreviewText(text);
    setWaPreviewLocation(firstLocation);
    setWaPreviewPhotoCount(photoCount);
    setWaPreviewFolders(folderSummary);
    setWaPreviewExpected({
      folderIds: [...includedShots.map((s) => s.id)].sort(),
      photoCount,
    });
    setWaPreviewOpen(true);
  }

  async function confirmSendWA() {
    const expected = waPreviewExpected;
    setWaPreviewOpen(false);
    const fake = { preventDefault() {}, stopPropagation() {} } as unknown as React.MouseEvent;
    try { await sendWA(fake, expected); } catch { /* dilaporkan di kartu */ }
  }

  // Aksi "Kembalikan ke aktif" untuk kartu Riwayat dilakukan lewat
  // DropdownMenu (memakai `doDelete()` yang sudah handle unmarkSent).
  // Fungsi inline `undoSent` lama dihapus supaya tidak ada handler duplikat.

  async function prepareChat(conversationId: string, convTitle: string) {
    if (chatSending || chatPreparing) return;
    if (shots.length === 0) {
      toast.info("Belum ada kiriman pegawai untuk judul ini.");
      return;
    }
    setLastSendChannel("chat");
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
      const MAX_CHAT_SLOTS = 10;
      let foldersIncluded = 0;
      const includedShots: typeof take = [];
      const failedPhotos: Array<{ shotId: string; folder: string; index: number }> = [];
      const chatFolderName = (s: typeof take[number]) =>
        s.source === "self" ? "Siapkan sendiri" : (s.item_name || r.name || `Kiriman ${s.id.slice(0, 6)}`);
      for (const s of take) {
        const paths = Array.from(new Set([
          ...((s.photo_paths ?? []) as string[]),
          ...(s.photo_path ? [s.photo_path] : []),
        ])).filter(Boolean);
        if (paths.length === 0) continue;
        // Atomik per folder: jangan mulai folder baru bila akan memotong
        // sebelum semua foto terkirim. Folder pertama tetap disertakan
        // utuh (bahkan bila > MAX_CHAT_SLOTS).
        if (foldersIncluded > 0 && chatShots.length + paths.length > MAX_CHAT_SLOTS) break;
        const folderStart = chatShots.length;
        for (let pi = 0; pi < paths.length; pi++) {
          const p = paths[pi];
          attemptedPaths++;
          const url = await resolveShotSignedUrl(p, s.source, 600);
          if (!url) { failedPhotos.push({ shotId: s.id, folder: chatFolderName(s), index: pi + 1 }); continue; }
          const f = await urlToFile(url, `${r.name}-${s.id.slice(0, 6)}-${pi + 1}.jpg`);
          if (f) {
            chatShots.push({ id: `${s.id}:${pi}`, file: f });
            if (thumbUrls.length < 4) thumbUrls.push(url);
          } else {
            failedPhotos.push({ shotId: s.id, folder: chatFolderName(s), index: pi + 1 });
          }
        }
        if (chatShots.length > folderStart) { foldersIncluded++; includedShots.push(s); }
      }
      // Judul & daftar item HARUS mencerminkan folder yang benar-benar ikut
      // terlampir, agar hitungan "kiriman" dan daftar foto konsisten.
      const firstLocation = includedShots.find((s) => s.location_url)?.location_url ?? null;
      const folderName = (s: typeof take[number]) =>
        s.source === "self" ? "Siapkan sendiri" : (s.item_name || r.name || `Kiriman ${s.id.slice(0, 6)}`);
      const lines = includedShots.map((s) => `• ${folderName(s)} — ${new Date(s.submitted_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`);
      const omitted = shots.length - includedShots.length;
      const caption = [
        `*${r.name}* (${r.product_name} · ${r.target_grams} ${unit})`,
        `${shots.length} kiriman pegawai${omitted > 0 ? ` (mengirim ${includedShots.length})` : ""} · ${chatShots.length} foto terlampir:`,
        ...lines,
      ].join("\n");
      toast.dismiss(tid);
      if (failedPhotos.length > 0) {
        const details = failedPhotos.map((f) => `${f.folder} · foto #${f.index}`);
        const preview = details.slice(0, 4).join(", ");
        const more = details.length > 4 ? ` (+${details.length - 4} lagi)` : "";
        toast.warning(
          `${failedPhotos.length}/${attemptedPaths} foto gagal dibaca: ${preview}${more}`,
          { description: "Foto tersebut tidak akan ikut dilampirkan ke Chat." },
        );
      }
      const preview: ChatSharePreviewData = {
        conversationTitle: convTitle,
        caption,
        photoCount: chatShots.length,
        folderCount: foldersIncluded,
        thumbs: thumbUrls,
        totalPhotos: chatShots.length,
        missingPhotos: Math.max(0, attemptedPaths - chatShots.length),
        failedPhotoLabels: failedPhotos.map((f) => `${f.folder} · foto #${f.index}`),
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
        // Pindah ke Riwayat terkirim = SATU entri per folder yang benar-benar
        // ikut atomically (includedShots), bukan `take` mentah.
        markIds: includedShots.map((s) => s.id),
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
    // Gerbang validasi: recompute folder atomik & jumlah foto dari `shots`
    // saat ini menggunakan logika yang sama dengan prepareChat. Bila hasilnya
    // berbeda dari snapshot pratinjau (ctx.markIds / ctx.chatShots), batalkan
    // agar pratinjau tidak pernah menyesatkan pesan yang benar-benar terkirim.
    {
      const takeNow = shots.slice(0, 6);
      const MAX_CHAT_SLOTS = 10;
      const includedNowIds: string[] = [];
      let photosNow = 0;
      let foldersIncluded = 0;
      for (const s of takeNow) {
        const paths = Array.from(new Set([
          ...((s.photo_paths ?? []) as string[]),
          ...(s.photo_path ? [s.photo_path] : []),
        ])).filter(Boolean);
        if (paths.length === 0) continue;
        if (foldersIncluded > 0 && photosNow + paths.length > MAX_CHAT_SLOTS) break;
        photosNow += paths.length;
        foldersIncluded++;
        includedNowIds.push(s.id);
      }
      const expectedIds = [...ctx.markIds].sort();
      const actualIds = [...includedNowIds].sort();
      const idsMatch =
        actualIds.length === expectedIds.length &&
        actualIds.every((id, i) => id === expectedIds[i]);
      // ctx.chatShots.length adalah jumlah foto yang benar-benar berhasil di-fetch;
      // jumlah *paths* saat pratinjau = photosNow saat itu. Bandingkan dengan
      // `photosNow` hasil recompute untuk mendeteksi perubahan sumber.
      const countMatch = photosNow === ctx.chatShots.length + (ctx.preview.missingPhotos ?? 0);
      if (!idsMatch || !countMatch) {
        toast.warning(
          `Kiriman berubah sejak pratinjau (folder ${expectedIds.length}→${actualIds.length}, foto ${ctx.chatShots.length + (ctx.preview.missingPhotos ?? 0)}→${photosNow}). Buka pratinjau ulang.`,
        );
        setChatPreviewOpen(false);
        setChatPreview(null);
        return;
      }
    }
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
      // Pindahkan kartu (foto + link) ke Riwayat terkirim secara otomatis,
      // agar simetris dengan alur WA. Tanpa ini, kiriman via Chat tidak
      // pernah pindah ke tab Riwayat sehingga terasa "belum terkirim".
      if (ctx.markIds.length > 0) {
        markSent(ctx.markIds, {
          channel: "chat",
          mapsUrl: ctx.locationUrl ?? null,
          status: "success",
          idemKey: ctx.idemKey,
        });
      }
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

  // ---------- Bulk action listeners (multi-pilih dari toolbar) ----------
  const autoBulkChat = useRef(false);
  useEffect(() => {
    const dispatchDone = () => window.dispatchEvent(new CustomEvent(`ecer-bulk-done:${r.id}`));
    const fake = { preventDefault() {}, stopPropagation() {} } as unknown as React.MouseEvent;
    const handleWa = async () => {
      try { await sendWA(fake); } catch { /* dilaporkan di kartu */ } finally { dispatchDone(); }
    };
    const handleChat = async (e: Event) => {
      const ev = e as CustomEvent<{ conversationId: string; conversationTitle: string }>;
      if (!ev.detail) { dispatchDone(); return; }
      autoBulkChat.current = true;
      try { await prepareChat(ev.detail.conversationId, ev.detail.conversationTitle); }
      catch { autoBulkChat.current = false; dispatchDone(); }
      // Lanjutan: effect auto-confirm di bawah akan menutup dialog & dispatch done.
    };
    const handleUndo = () => {
      try { unmarkSent(shots.map((s) => s.id)); } finally { dispatchDone(); }
    };
    const handleSkip = () => {
      try {
        if (shots.length > 0) {
          markSent(shots.map((s) => s.id), {
            channel: "wa",
            mapsUrl: null,
            status: "success",
            idemKey: `bulk-skip-${r.id}-${Date.now()}`,
          });
        }
      } finally { dispatchDone(); }
    };
    window.addEventListener(`ecer-bulk:wa:${r.id}`, handleWa as EventListener);
    window.addEventListener(`ecer-bulk:chat:${r.id}`, handleChat as EventListener);
    window.addEventListener(`ecer-bulk:undo:${r.id}`, handleUndo as EventListener);
    window.addEventListener(`ecer-bulk:skip:${r.id}`, handleSkip as EventListener);
    return () => {
      window.removeEventListener(`ecer-bulk:wa:${r.id}`, handleWa as EventListener);
      window.removeEventListener(`ecer-bulk:chat:${r.id}`, handleChat as EventListener);
      window.removeEventListener(`ecer-bulk:undo:${r.id}`, handleUndo as EventListener);
      window.removeEventListener(`ecer-bulk:skip:${r.id}`, handleSkip as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.id, shots]);

  // Auto-confirm bulk-chat saat tidak ada duplikat — supaya satu klik bulk
  // memproses semua kartu tanpa harus menekan tombol Kirim di tiap pratinjau.
  useEffect(() => {
    if (!autoBulkChat.current) return;
    if (chatPreview && !chatPreview.duplicate && !chatSending && chatPreviewOpen) {
      void confirmChatSend();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatPreview, chatPreviewOpen]);

  // Tutup dialog & beritahu orkestrator bulk saat satu kartu selesai.
  useEffect(() => {
    if (!autoBulkChat.current) return;
    if (!chatSending && chatStatus?.outcome) {
      autoBulkChat.current = false;
      setChatPreviewOpen(false);
      setChatPreview(null);
      setChatStatus(null);
      window.dispatchEvent(new CustomEvent(`ecer-bulk-done:${r.id}`));
    }
  }, [chatSending, chatStatus, r.id]);

  return (
    <div
      ref={cardRootRef}
      data-just-moved={justMoved ? "1" : undefined}
      role={selectMode ? undefined : "button"}
      tabIndex={selectMode ? undefined : 0}
      aria-label={
        selectMode
          ? `${selected ? "Lepas pilihan" : "Pilih"} kartu ${r.name}`
          : view === "sent"
            ? `${expanded ? "Tutup" : "Buka"} detail riwayat kartu ${r.name} — ${r.product_name} ${r.target_grams}${unit}, ${shots.length} kiriman terkirim`
            : `Buka detail kartu ${r.name} — ${r.product_name} ${r.target_grams}${unit}, ${r.prep_count} kotak siap`
      }
      aria-describedby={`ecer-card-desc-${r.id}`}
      aria-pressed={selectMode ? selected : undefined}
      aria-expanded={selectMode ? undefined : view === "sent" ? expanded : undefined}
      onKeyDown={
        selectMode
          ? undefined
          : (e) => {
              if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
              const target = e.target as HTMLElement | null;
              // Bila fokus ada di anak interaktif (tombol menu ⋮, tombol Kirim,
              // link Maps, checkbox pilih), biarkan elemen tersebut menangani
              // Enter/Space sesuai perannya sendiri.
              if (target && target !== e.currentTarget && target.closest("a, button, input, textarea, select, [role='button'], [role='menuitem'], [role='checkbox'], [data-radix-collection-item]")) {
                return;
              }
              // Cegah scroll halaman saat Space ditekan di container kartu.
              e.preventDefault();
              e.stopPropagation();
              handleCardOpen();
            }
      }
      className={`group relative flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm outline-none transition hover:border-primary/60 hover:shadow-md active:scale-[0.997] active:bg-accent/30 focus-visible:z-10 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer ${
        selected ? "ring-2 ring-primary ring-offset-1" : ""
      } ${
        justMoved ? "ring-2 ring-success ring-offset-2 shadow-lg shadow-success/20 animate-pulse" : ""
      }`}
      onClickCapture={
        selectMode
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelect?.();
            }
          : (e) => {
              if (longPressFired.current) {
                e.preventDefault();
                e.stopPropagation();
                longPressFired.current = false;
                return;
              }
              // Buat seluruh kartu bisa di-tap untuk membuka detail /ecer,
              // termasuk area SentDetailList / thumbnails / badge yang tidak
              // dibungkus <Link>. Anak-anak interaktif (dropdown menu, tombol
              // Kirim, popover, anchor Maps) sudah memanggil stopPropagation
              // sendiri, jadi tidak akan sampai ke sini.
              const target = e.target as HTMLElement | null;
              if (target && target.closest("a, button, input, textarea, select, [role='button'], [role='menuitem'], [data-radix-collection-item]")) {
                return;
              }
              handleCardOpen();
            }
      }
      onPointerDown={selectMode ? undefined : startLongPress}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
    >
      <span id={`ecer-card-desc-${r.id}`} className="sr-only">
        {view === "sent"
          ? `Riwayat terkirim. ${shots.length} kiriman pegawai${
              thumbs[0]?.location_url ? ", ada lokasi GPS" : ""
            }. Tekan Enter untuk membuka detail di Ecer, atau tekan menu untuk kembalikan ke aktif.`
          : `Daftar aktif. ${r.prep_count} kotak siap${
              shots.length > 0 ? `, ${shots.length} foto dari pegawai` : ", belum ada foto pegawai"
            }. Tekan Enter untuk membuka detail di Ecer.`}
      </span>
      {!selectMode && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Menu aksi kartu ${r.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(true); }}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute right-1.5 top-1.5 z-30 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-card/90 text-muted-foreground shadow-sm backdrop-blur-sm transition hover:bg-accent hover:text-foreground"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuLabel className="truncate">{r.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {view === "sent" ? (
              <>
                <DropdownMenuItem onSelect={() => { setMenuOpen(false); doDelete(); }}>
                  <Undo2 className="mr-2 h-3.5 w-3.5" />
                  Kembalikan ke aktif
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={async () => {
                    setMenuOpen(false);
                    if (shots.length === 0) {
                      toast.info("Tidak ada kiriman untuk dihapus.");
                      return;
                    }
                    const ok = await confirmDialog({
                      title: `Hapus kartu "${r.name}" dari Riwayat?`,
                      description:
                        "Kartu akan disembunyikan dari Riwayat terkirim dan tidak akan kembali ke daftar Aktif. Foto pegawai tetap ada di database.",
                      confirmText: "Hapus",
                      destructive: true,
                    });
                    if (!ok) return;
                    hideSent(shots.map((s) => s.id));
                    toast.success("Kartu dihapus dari Riwayat.");
                  }}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Hapus dari Riwayat
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={() => { setMenuOpen(false); setConfirmDelete(true); }} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Hapus (tandai terkirim)
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => {
                setMenuOpen(false);
                onEnterSelect?.();
              }}
              className="hidden sm:flex"
            >
              <CheckSquare className="mr-2 h-3.5 w-3.5" />
              Pilih beberapa
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setMenuOpen(false);
                onRefresh();
              }}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Segarkan
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus kartu "{r.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Kartu akan ditandai terkirim tanpa mengirim ke WA atau Chat, lalu pindah ke tab Riwayat terkirim. Anda bisa mengembalikannya dari sana.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Ya, hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={waPreviewOpen} onOpenChange={setWaPreviewOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()} className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Pratinjau pesan WhatsApp</AlertDialogTitle>
            <AlertDialogDescription>
              Periksa isi teks sebelum dikirim. {waPreviewPhotoCount > 0 ? `${waPreviewPhotoCount} foto akan dilampirkan.` : "Tidak ada foto yang bisa dilampirkan."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-primary/20 bg-primary/5 p-ms-2.5">
            <div className="flex items-center justify-between text-ms-xs font-semibold">
              <span className="text-foreground">Ringkasan payload</span>
              <span className="text-primary">
                {waPreviewFolders.filter((f) => f.included).length} kiriman · {waPreviewPhotoCount} foto terlampir
              </span>
            </div>
          </div>
          {waPreviewFolders.length > 0 && (
            <div className="rounded-md border bg-background p-ms-2">
              <div className="mb-1 flex items-center justify-between text-ms-2xs font-semibold">
                <span>Pengelompokan folder</span>
                <span className="text-muted-foreground">
                  {waPreviewFolders.filter((f) => f.included).length}/{waPreviewFolders.length} folder · {waPreviewPhotoCount} foto
                </span>
              </div>
              <ul className="space-y-0.5 text-ms-2xs">
                {waPreviewFolders.map((f, i) => (
                  <li
                    key={i}
                    className={`flex items-center justify-between gap-ms-2 rounded px-1.5 py-1 ${
                      f.included ? "bg-success/10 text-foreground" : "bg-muted/60 text-muted-foreground line-through"
                    }`}
                  >
                    <span className="truncate">{f.label}</span>
                    <span className="shrink-0 tabular-nums">{f.count} foto{f.included ? "" : " · dilewati"}</span>
                  </li>
                ))}
              </ul>
              {waPreviewFolders.some((f) => !f.included) && (
                <p className="mt-1 text-ms-2xs text-muted-foreground">
                  Folder dilewati karena batas 10 foto per pengiriman. Kirim sisanya di batch berikutnya.
                </p>
              )}
            </div>
          )}
          <div className="max-h-[50vh] overflow-y-auto rounded-md border bg-muted/40 p-ms-3">
            <pre className="whitespace-pre-wrap break-words font-sans text-ms-xs leading-relaxed text-foreground">{waPreviewText}</pre>
            {waPreviewLocation && (
              <a
                href={waPreviewLocation}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-ms-1 text-ms-2xs font-medium text-primary underline underline-offset-2"
                onClick={(e) => e.stopPropagation()}
              >
                <MapPin className="h-3 w-3" /> Buka lokasi di peta
              </a>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSendWA} className="bg-wa text-wa-foreground hover:bg-wa/90">
              <MessageCircle className="mr-1 h-3.5 w-3.5" /> Kirim WA
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {selectMode && (
        <button
          type="button"
          aria-label={selected ? `Lepas pilihan kartu ${r.name}` : `Pilih kartu ${r.name}`}
          aria-pressed={selected}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect?.(); }}
          className={`absolute left-1.5 top-1.5 z-20 inline-flex h-6 w-6 items-center justify-center rounded-md border shadow-sm transition ${
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card/90 text-muted-foreground hover:bg-accent"
          }`}
        >
          {selected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
      )}
      {shots.length > 0 ? (
        view === "sent" ? (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded((v) => !v); }}
          aria-label={`${expanded ? "Tutup" : "Buka"} detail riwayat ${r.name} — ${shots.length} foto${thumbs[0]?.location_url ? ", dengan lokasi GPS" : ""}`}
          aria-expanded={expanded}
          className="relative block aspect-[4/3] w-full overflow-hidden bg-muted text-left"
        >
          {thumbs[0]?.thumb_url ? (
            <img src={thumbs[0].thumb_url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
          ) : (
            <div
              aria-hidden
              className="h-full w-full animate-pulse bg-gradient-to-br from-muted via-muted/60 to-muted"
            />
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-ms-2">
            <div className="flex min-w-0 items-center gap-ms-1 text-ms-2xs font-medium leading-none text-white/90">
              <Scale className="h-2.5 w-2.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate" title={r.name}>{r.name}</span>
            </div>
          </div>
          <span className="absolute left-1.5 top-1.5 inline-flex h-5 shrink-0 items-center gap-ms-1 whitespace-nowrap rounded-full bg-info/95 px-1.5 text-ms-2xs font-semibold leading-none text-white shadow-sm">
            {shots.length} foto
          </span>
          {thumbs[0]?.location_url && (
            <span className="absolute right-9 top-1.5 inline-flex h-5 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full bg-black/60 px-1.5 text-ms-2xs font-medium leading-none text-white backdrop-blur-sm">
              <MapPin className="h-2.5 w-2.5" /> GPS
            </span>
          )}
        </button>
        ) : (
        <Link
          to="/ecer"
          search={{ item: r.warehouse_item_id, title: r.id, highlight: undefined, send: undefined }}
          aria-label={`Buka foto ${r.name} — ${shots.length} foto${thumbs[0]?.location_url ? ", dengan lokasi GPS" : ""}`}
          className="relative block aspect-[4/3] overflow-hidden bg-muted"
        >
          {thumbs[0]?.thumb_url ? (
            <img src={thumbs[0].thumb_url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
          ) : (
            <div
              aria-hidden
              className="h-full w-full animate-pulse bg-gradient-to-br from-muted via-muted/60 to-muted"
            />
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-ms-2">
            <div className="flex min-w-0 items-center gap-ms-1 text-ms-2xs font-medium leading-none text-white/90">
              <Scale className="h-2.5 w-2.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate" title={r.name}>{r.name}</span>
            </div>
          </div>
          <span className="absolute left-1.5 top-1.5 inline-flex h-5 shrink-0 items-center gap-ms-1 whitespace-nowrap rounded-full bg-info/95 px-1.5 text-ms-2xs font-semibold leading-none text-white shadow-sm">
            {shots.length} foto
          </span>
          {thumbs[0]?.location_url && (
            <span className="absolute right-9 top-1.5 inline-flex h-5 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full bg-black/60 px-1.5 text-ms-2xs font-medium leading-none text-white backdrop-blur-sm">
              <MapPin className="h-2.5 w-2.5" /> GPS
            </span>
          )}
        </Link>
        )
      ) : null}

      <div className="flex flex-col gap-ms-1.5 p-ms-2">
        <Link
          to="/ecer"
          search={{ item: r.warehouse_item_id, title: r.id, highlight: undefined, send: undefined }}
          data-testid={`ready-ecer-card-${r.id}`}
          aria-label={view === "sent" ? `${expanded ? "Tutup" : "Buka"} detail riwayat ${r.name}` : `Buka detail ${r.name} di halaman Ecer`}
          aria-expanded={view === "sent" ? expanded : undefined}
          onClick={view === "sent" ? (e) => { e.preventDefault(); e.stopPropagation(); setExpanded((v) => !v); } : undefined}
          className="flex flex-col gap-0.5"
        >
          {shots.length === 0 && (
            <div className="flex min-w-0 items-center gap-ms-1.5">
              <Scale className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-ms-xs font-semibold leading-snug" title={r.name}>{r.name}</span>
            </div>
          )}
          <span className="block min-w-0 truncate text-ms-2xs font-medium leading-none text-foreground/80" title={`${r.product_name} · ${r.target_grams} ${unit}`}>
            {r.product_name} · {r.target_grams} {unit}
          </span>
          <SyncBadge row={r} />
          <SendStatusBadge
            status={sendStatus}
            error={sendError}
            view={view}
            lastSentAt={lastSentAt}
            sentCount={view === "sent" ? shots.length : 0}
            now={now}
            resendLabel={lastSendChannel === "chat" ? "Kirim ulang Chat" : "Kirim ulang WA"}
            onResend={
              sending || chatSending || chatPreparing
                ? undefined
                : () => {
                    const fake = {
                      preventDefault() {},
                      stopPropagation() {},
                    } as unknown as React.MouseEvent;
                    if (lastSendChannel === "chat") {
                      // Buka lagi pratinjau Chat terakhir tanpa menandai foto ulang.
                      // chatPreview + snapshot idempotency masih tersedia — pengguna
                      // cukup menekan "Kirim" lagi di dialog.
                      if (chatPreview) {
                        setChatPreviewOpen(true);
                      } else {
                        toast.info("Pilih tujuan Chat lagi untuk mengirim ulang.");
                        setPickChatOpen(true);
                      }
                    } else {
                      // WA: buka pratinjau supaya folder yang sama (via snapshot
                      // idempotency) dikirim ulang tanpa foto perlu ditandai ulang.
                      openWAPreview(fake);
                    }
                  }
            }
          />
          {/* Popover "Cocok: produk + Xg" dihapus dari kartu Beranda — info
              sama sudah tampil di baris produk di atas. Aturan pencocokan +
              ID mentah tetap tersedia di halaman detail /ecer bila diperlukan
              untuk audit. Ini bagian dari simplifikasi "1 kartu = 1 aksi". */}
          <span className="text-ms-2xs leading-snug">
            <span
              data-testid={`ready-ecer-badge-${r.id}`}
              data-badge-count={r.prep_count}
              className={r.prep_count > 0 ? "font-semibold text-success dark:text-success" : "text-muted-foreground"}
            >
              {r.prep_count} kotak siap
            </span>
          </span>
          {view === "sent" && (
            <span className="mt-0.5 inline-flex items-center gap-ms-1 self-start rounded-full bg-muted px-1.5 py-0.5 text-ms-2xs font-semibold text-muted-foreground">
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
              {expanded ? "Sembunyikan detail" : `Lihat detail kiriman (${shots.length})`}
            </span>
          )}
        </Link>

        {view === "sent" && expanded && (
          <div onClick={(e) => e.stopPropagation()}>
            <SentDetailList shots={shots} details={sentDetails} />
          </div>
        )}

        {shots.length === 0 ? (
          <div className="flex items-center gap-ms-1.5 rounded-md border border-dashed bg-muted/30 px-ms-2 py-1.5">
            {syncing || refreshing ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
            ) : (
              <Inbox className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-ms-2xs text-muted-foreground">
              {syncing || refreshing
                ? "Memuat kiriman…"
                : realtimeStatus === "offline"
                ? "Realtime terputus"
                : "Menunggu foto pegawai"}
            </span>
            <button
              type="button"
              aria-label={`Segarkan kiriman pegawai untuk ${r.name}`}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRefresh(); }}
              disabled={refreshing}
              title="Segarkan"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              <RefreshCw className={`h-2.5 w-2.5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        ) : (
          <>
          <div className="flex flex-wrap items-center gap-ms-1.5">
            {thumbs.slice(1, 4).map((s) => (
              <div key={s.id} className="relative h-7 w-7 shrink-0 overflow-hidden rounded border border-card bg-muted ring-1 ring-border">
                {s.thumb_url ? (
                  <img src={s.thumb_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : null}
              </div>
            ))}
            {extra > 0 && (
              <div
                role="img"
                aria-label={`${extra} foto lainnya`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-card bg-muted text-ms-2xs font-semibold text-muted-foreground ring-1 ring-border"
              >
                +{extra}
              </div>
            )}
            <div className="ml-auto flex w-full items-center justify-end gap-ms-1.5 sm:w-auto">
            {/*
              Semua alur "Kirim ke pembeli" wajib lewat verifikasi
              pembayaran (Lunas / Hutang / Bayar sebagian) di halaman detail
              /ecer. Tombol WA/Chat share cepat lama dihapus dari dashboard
              agar tidak ada jalur tembus yang melewati sistem pembayaran.
              Owner tetap bisa memakai fitur share foto pegawai langsung
              dari detail judul kalau memang perlu koordinasi internal.
            */}
            {view === "sent" ? null : r.prep_count > 0 ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Pangkas gate: langsung buka halaman detail dengan
                    // flag send=1. Modal pembayaran akan langsung terbuka
                    // di /ecer tanpa dialog perantara.
                    navigate({
                      to: "/ecer",
                      search: { item: r.warehouse_item_id, title: r.id, highlight: undefined, send: "1" },
                    });
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={`Verifikasi bayar untuk ${r.prep_count} kotak ${r.name}`}
                  title="Buka dialog verifikasi pembayaran — stok & lunas/hutang dicatat sebelum kirim ke pembeli"
                  className="inline-flex h-7 shrink-0 items-center justify-center gap-ms-1 rounded-md bg-wa px-ms-2 text-ms-2xs font-semibold text-wa-foreground shadow-sm transition hover:bg-wa/90"
                >
                  <Send className="h-3 w-3" /> Verifikasi bayar
                </button>
                <span
                  className="inline-flex h-6 w-6 shrink-0 cursor-help items-center justify-center rounded-full border bg-background text-ms-2xs font-medium text-muted-foreground"
                  title="Alur: verifikasi pembayaran (lunas/hutang/bayar sebagian) dulu, baru kirim ke pembeli via WA/Chat."
                  aria-label="Info alur verifikasi bayar"
                >
                  ⓘ
                </span>
              </>
            ) : (
              <Link
                to="/ecer"
                search={{ item: r.warehouse_item_id, title: r.id, highlight: undefined, send: undefined }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Siapkan minimal 1 kotak untuk ${r.name} sebelum bisa dikirim`}
                title="Belum ada kotak siap — buka detail untuk menyiapkan kotak dulu"
                className="inline-flex h-7 shrink-0 items-center justify-center gap-ms-1 rounded-md border border-dashed border-primary/50 bg-primary/5 px-ms-2 text-ms-2xs font-semibold text-primary shadow-sm transition hover:bg-primary/10"
              >
                <Send className="h-3 w-3 opacity-70" /> Siapkan kotak →
              </Link>
            )}
            {/* Aksi "Kembalikan ke aktif" dan "Hapus dari Riwayat" untuk
                view === "sent" dikonsolidasi ke DropdownMenu di kanan atas
                kartu — tombol inline "Aktif" dihapus supaya tidak duplikat. */}
            </div>
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
        conversationId={chatPreview?.conversationId ?? null}
        peer={chatPreview ? { name: chatPreview.conversationTitle } : null}
      />
    </div>
  );
}