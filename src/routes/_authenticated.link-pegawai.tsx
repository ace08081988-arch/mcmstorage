import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { publicTaskUrl, isValidShareToken, InvalidShareTokenError, genShareToken, genPin } from "@/lib/prep";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ExternalLink, Copy, Link2, Search, RefreshCw, ChevronLeft, Loader2, ArrowUpDown, KeyRound, FlaskConical, Sparkles, AlertTriangle, CircleSlash, ShieldCheck, Timer, RotateCw, LockKeyhole, MessageCircle, Dices } from "lucide-react";

const PAGE_SIZE = 30;
const REGEN_FRESH_WINDOW_MS = 5 * 60 * 1000;

type TokenState =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "fresh"; ageMs: number }
  | { kind: "valid" };

function classifyToken(token: string | null | undefined, regenAt: number | undefined, now: number): TokenState {
  if (!token) return { kind: "empty" };
  if (!isValidShareToken(token)) return { kind: "invalid" };
  if (regenAt != null) {
    const age = now - regenAt;
    if (age >= 0 && age < REGEN_FRESH_WINDOW_MS) return { kind: "fresh", ageMs: age };
  }
  return { kind: "valid" };
}

function formatCountdown(ms: number): { text: string; tone: "ok" | "warn" | "danger" } {
  if (ms <= 0) return { text: "kedaluwarsa", tone: "danger" };
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const tone: "ok" | "warn" | "danger" =
    ms < 60 * 60 * 1000 ? "danger" : ms < 24 * 60 * 60 * 1000 ? "warn" : "ok";
  if (d > 0) return { text: `${d}h ${h}j lagi`, tone };
  if (h > 0) return { text: `${h}j ${m}m lagi`, tone };
  if (m > 0) return { text: `${m}m ${sec}d lagi`, tone };
  return { text: `${sec}d lagi`, tone };
}

export const Route = createFileRoute("/_authenticated/link-pegawai")({
  head: () => ({
    meta: [
      { title: "Link Pegawai · MCM Storage" },
      { name: "description", content: "Daftar semua link tugas pegawai dengan status ketersediaan." },
    ],
  }),
  component: LinkPegawaiPage,
});

type Task = {
  id: string;
  title: string;
  note: string | null;
  share_token: string;
  status: string;
  expires_at: string;
  created_at: string;
};

type Availability = "active" | "expired" | "done" | "cancelled";

function computeAvailability(t: Task, now: number): Availability {
  if (t.status === "cancelled") return "cancelled";
  if (t.status === "done") return "done";
  if (new Date(t.expires_at).getTime() <= now) return "expired";
  return "active";
}

const BADGE: Record<Availability, { label: string; cls: string }> = {
  active: { label: "Aktif", cls: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-400" },
  expired: { label: "Kedaluwarsa", cls: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-400" },
  done: { label: "Selesai", cls: "bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-400" },
  cancelled: { label: "Dibatalkan", cls: "bg-muted text-muted-foreground ring-border" },
};

type SortKey = "newest" | "oldest" | "status";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Terbaru" },
  { key: "oldest", label: "Terlama" },
  { key: "status", label: "Status (Aktif dulu)" },
];

// Server orders by created_at; for "status" we still fetch newest-first
// from the server and re-sort the loaded set client-side.
const STATUS_ORDER: Record<Availability, number> = {
  active: 0,
  expired: 1,
  done: 2,
  cancelled: 3,
};

function LinkPegawaiPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenId, setRegenId] = useState<string | null>(null);
  const [regenAt, setRegenAt] = useState<Record<string, number>>({});
  const [resetTask, setResetTask] = useState<Task | null>(null);
  const [resetPin, setResetPin] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState<number | null>(null);
  const [filteredTotal, setFilteredTotal] = useState<number | null>(null);
  const [filteredTotalBusy, setFilteredTotalBusy] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Availability>("all");
  const [tokenFilter, setTokenFilter] = useState<"all" | TokenState["kind"]>("all");
  const [tokenKw, setTokenKw] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [now, setNow] = useState(Date.now());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const filteredFetchedOnceRef = useRef(false);
  const refetchToastIdRef = useRef<string | number | null>(null);

  // Server-side order direction: only "oldest" flips it; "status" keeps newest-first fetch.
  const serverAscending = sort === "oldest";

  const reload = useCallback(async () => {
    setBusy(true);
    setLoadError(null);
    // Pastikan sesi masih ada — auto-lock kadang menghapus token sehingga
    // query berikutnya 401 dan halaman terjebak di status "Memuat…".
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setBusy(false);
      setTasks([]);
      setLoadError("Sesi berakhir. Silakan muat ulang halaman atau masuk kembali.");
      return;
    }
    const { data, error, count } = await supabase
      .from("prep_tasks")
      .select("id,title,note,share_token,status,expires_at,created_at", { count: "exact" })
      .order("created_at", { ascending: serverAscending })
      .range(0, PAGE_SIZE - 1);
    setBusy(false);
    if (error) {
      const msg = error.message || "Tidak diketahui";
      toast.error("Gagal memuat: " + msg);
      // Jangan biarkan UI terkunci di skeleton "Memuat…" — tampilkan pesan
      // error + tombol coba lagi.
      setTasks((prev) => prev ?? []);
      setLoadError(msg);
      return;
    }
    const rows = (data ?? []) as Task[];
    setTasks(rows);
    setTotal(count ?? rows.length);
    setHasMore(rows.length === PAGE_SIZE && (count == null || rows.length < count));
  }, [serverAscending]);

  // Server-side count for the active filter + search combination.
  // Sort does not affect the count, so it's intentionally excluded from deps.
  const fetchFilteredTotal = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    setFilteredTotalBusy(true);
    let query = supabase
      .from("prep_tasks")
      .select("id", { count: "exact", head: true });

    // Use a fresh timestamp at query time. Including `now` in deps would
    // recreate this callback on every tick (30s or 1s in test mode) and
    // spam the server with count queries from the effect below.
    const nowIso = new Date().toISOString();
    if (filter === "cancelled") query = query.eq("status", "cancelled");
    else if (filter === "done") query = query.eq("status", "done");
    else if (filter === "active") {
      query = query.not("status", "in", "(cancelled,done)").gt("expires_at", nowIso);
    } else if (filter === "expired") {
      query = query.not("status", "in", "(cancelled,done)").lte("expires_at", nowIso);
    }

    const needle = q.trim();
    if (needle) {
      const esc = needle.replace(/[%,()]/g, " ");
      query = query.or(`title.ilike.%${esc}%,share_token.ilike.%${esc}%`);
    }

    const { count, error } = await query;
    setFilteredTotalBusy(false);
    if (error) {
      setFilteredTotal(null);
      if (!silent) toast.error("Gagal menghitung total");
      return;
    }
    const next = count ?? 0;
    setFilteredTotal(next);
    // Only toast for user-triggered refetches (not the initial mount fetch),
    // and only when there is an active filter/search so the message is meaningful.
    const isFiltered = filter !== "all" || q.trim().length > 0;
    if (!silent && filteredFetchedOnceRef.current && isFiltered) {
      if (refetchToastIdRef.current != null) toast.dismiss(refetchToastIdRef.current);
      refetchToastIdRef.current = toast.success(`Total diperbarui: ${next} sesuai filter`, {
        duration: 1800,
      });
    }
    filteredFetchedOnceRef.current = true;
  }, [filter, q]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || tasks === null) return;
    setLoadingMore(true);
    const from = tasks.length;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("prep_tasks")
      .select("id,title,note,share_token,status,expires_at,created_at")
      .order("created_at", { ascending: serverAscending })
      .range(from, to);
    setLoadingMore(false);
    if (error) { toast.error("Gagal memuat lanjutan: " + error.message); return; }
    const more = (data ?? []) as Task[];
    setTasks((prev) => {
      const base = prev ?? [];
      const seen = new Set(base.map((t) => t.id));
      const merged = [...base, ...more.filter((t) => !seen.has(t.id))];
      return merged;
    });
    if (more.length < PAGE_SIZE) setHasMore(false);
    if (total != null && tasks.length + more.length >= total) setHasMore(false);
  }, [loadingMore, hasMore, tasks, total, serverAscending]);

  useEffect(() => { void reload(); }, [reload]);
  // Refetch the filtered server total whenever filter/search changes or data is reloaded.
  // Debounce search input slightly to avoid spamming the server while typing.
  useEffect(() => {
    const id = setTimeout(() => { void fetchFilteredTotal(); }, q ? 250 : 0);
    return () => clearTimeout(id);
  }, [fetchFilteredTotal, tasks]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), testMode ? 1_000 : 30_000);
    return () => clearInterval(id);
  }, [testMode]);

  // Infinite scroll sentinel.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) void loadMore();
      }
    }, { rootMargin: "240px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const rows = useMemo(() => {
    const list = (tasks ?? []).map((t) => ({
      t,
      avail: computeAvailability(t, now),
      tokenState: classifyToken(t.share_token, regenAt[t.id], now),
    }));
    const filtered = list.filter(({ t, avail, tokenState }) => {
      if (filter !== "all" && avail !== filter) return false;
      if (tokenFilter !== "all" && tokenState.kind !== tokenFilter) return false;
      if (tokenKw.trim()) {
        const n = tokenKw.trim().toLowerCase();
        if (!t.title.toLowerCase().includes(n) && !t.id.toLowerCase().includes(n)) return false;
      }
      if (q.trim()) {
        const needle = q.trim().toLowerCase();
        if (!t.title.toLowerCase().includes(needle) && !t.share_token.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
    if (sort === "status") {
      filtered.sort((a, b) => {
        const d = STATUS_ORDER[a.avail] - STATUS_ORDER[b.avail];
        if (d !== 0) return d;
        // Tie-breaker: newest first.
        return new Date(b.t.created_at).getTime() - new Date(a.t.created_at).getTime();
      });
    }
    // "newest" / "oldest" come pre-sorted from the server.
    return filtered;
  }, [tasks, q, filter, tokenFilter, tokenKw, now, sort, regenAt]);

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, expired: 0, done: 0, cancelled: 0 } as Record<string, number>;
    for (const t of tasks ?? []) {
      const a = computeAvailability(t, now);
      c.all += 1;
      c[a] += 1;
    }
    return c;
  }, [tasks, now]);

  const tokenCounts = useMemo(() => {
    const c = { all: 0, valid: 0, fresh: 0, invalid: 0, empty: 0 } as Record<string, number>;
    for (const t of tasks ?? []) {
      c.all += 1;
      c[classifyToken(t.share_token, regenAt[t.id], now).kind] += 1;
    }
    return c;
  }, [tasks, regenAt, now]);

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link disalin");
    } catch {
      toast.error("Gagal menyalin");
    }
  }

  async function regenerateToken(taskId: string, opts?: { extendDays?: number }) {
    setRegenId(taskId);
    const extendDays = opts?.extendDays;
    const newExpiresAt = extendDays && extendDays > 0
      ? new Date(Date.now() + extendDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
    // Coba beberapa kali jika token unik bentrok (sangat kecil kemungkinannya).
    let lastErr: string | null = null;
    for (let i = 0; i < 3; i++) {
      const next = genShareToken();
      const patch: { share_token: string; expires_at?: string } = { share_token: next };
      if (newExpiresAt) patch.expires_at = newExpiresAt;
      const { data, error } = await supabase
        .from("prep_tasks")
        .update(patch)
        .eq("id", taskId)
        .select("id,share_token,expires_at")
        .maybeSingle();
      if (!error && data) {
        setTasks((prev) => (prev ? prev.map((t) => (t.id === taskId ? { ...t, share_token: data.share_token, expires_at: data.expires_at ?? t.expires_at } : t)) : prev));
        setRegenAt((prev) => ({ ...prev, [taskId]: Date.now() }));
        setRegenId(null);
        toast.success(newExpiresAt
          ? `Link diperpanjang ${extendDays} hari & token baru aktif`
          : "Token diperbarui — link baru siap dipakai");
        return;
      }
      lastErr = error?.message ?? "Tidak ada baris yang diperbarui (izin?)";
      if (error && !/duplicate|unique/i.test(error.message)) break;
    }
    setRegenId(null);
    toast.error("Gagal memperbarui token: " + (lastErr ?? "tidak diketahui"));
  }

  function openResetPin(task: Task) {
    setResetTask(task);
    setResetPin(genPin());
    setResetDone(false);
  }

  async function submitResetPin() {
    if (!resetTask) return;
    if (!/^\d{4,8}$/.test(resetPin)) {
      toast.error("PIN harus 4–8 digit angka");
      return;
    }
    setResetBusy(true);
    const { error } = await supabase.rpc("prep_reset_pin", { _task_id: resetTask.id, _pin: resetPin });
    setResetBusy(false);
    if (error) {
      toast.error("Gagal reset PIN: " + error.message);
      return;
    }
    setResetDone(true);
    toast.success("PIN baru aktif — PIN lama tidak berlaku");
  }

  async function copyPin() {
    try {
      await navigator.clipboard.writeText(resetPin);
      toast.success("PIN disalin");
    } catch {
      toast.error("Gagal menyalin");
    }
  }

  async function sharePinToWa() {
    if (!resetTask) return;
    let url = "";
    try { url = publicTaskUrl(resetTask.share_token); } catch { /* ignore */ }
    const lines = [
      `Halo, berikut akses tugas: ${resetTask.title}`,
      url ? `Link: ${url}` : null,
      `PIN baru: ${resetPin}`,
      "Mohon jangan dibagikan ke orang lain. PIN lama tidak berlaku lagi.",
    ].filter(Boolean) as string[];
    const res = await shareToWhatsApp({ text: lines.join("\n"), title: resetTask.title });
    notifyShareResult(res);
  }

  return (
    <div className="mx-auto max-w-4xl px-3 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Link to="/" className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted">
          <ChevronLeft className="h-3.5 w-3.5" /> Beranda
        </Link>
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          <h1 className="text-base font-semibold">Link Pegawai</h1>
        </div>
        <button
          onClick={() => void reload()}
          disabled={busy}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Muat ulang
        </button>
        <button
          onClick={() => setTestMode((v) => !v)}
          aria-pressed={testMode}
          title="Tampilkan status token dan hitung mundur kedaluwarsa"
          className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs transition ${
            testMode
              ? "border-primary bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <FlaskConical className="h-3.5 w-3.5" /> Mode Uji {testMode ? "Aktif" : "Mati"}
        </button>
      </div>

      {testMode && (
        <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] text-foreground/80" data-compact-hide>
          <div className="flex items-center gap-1.5 font-medium text-primary">
            <FlaskConical className="h-3.5 w-3.5" /> Mode Uji Coba Token
          </div>
          <div className="mt-0.5 leading-relaxed">
            Indikator status token tampil di tiap baris:{" "}
            <span className="font-medium text-emerald-600 dark:text-emerald-400">Valid</span> ·{" "}
            <span className="font-medium text-sky-600 dark:text-sky-400">Baru dibuat</span> ·{" "}
            <span className="font-medium text-amber-600 dark:text-amber-400">Invalid</span> ·{" "}
            <span className="font-medium text-destructive">Kosong</span>. Hitung mundur kedaluwarsa diperbarui tiap detik.
          </div>
        </div>
      )}

      <p className="mb-3 text-xs text-muted-foreground" data-compact-hide>
        Semua tugas pegawai yang sudah pernah dibuat — link, status ketersediaan, dan akses langsung untuk pratinjau.
        {total != null && (() => {
          const loaded = tasks?.length ?? 0;
          const shown = rows.length;
          const isFiltered = filter !== "all" || q.trim().length > 0;
          // Use server-side filtered count when a filter/search is active; fall back to unfiltered total.
          const effectiveTotal = isFiltered ? (filteredTotal ?? total) : total;
          const remaining = Math.max(0, effectiveTotal - shown);
          // Show skeleton on the filtered total whenever the server count is being recomputed
          // (initial fetch after filter/search change, or while data is reloading).
          const totalLoading = isFiltered && (filteredTotalBusy || filteredTotal == null);
          const TotalNum = ({ value }: { value: number }) =>
            totalLoading ? (
              <span
                className="inline-block h-3 w-8 -mb-0.5 animate-pulse rounded bg-muted align-middle"
                aria-label="Menghitung total…"
                aria-busy="true"
              />
            ) : (
              <b className="tabular-nums">{value}</b>
            );
          return (
            <>
              {" · "}
              {isFiltered ? (
                <>
                  Menampilkan <b className="tabular-nums">{shown}</b> dari{" "}
                  <TotalNum value={effectiveTotal} /> sesuai filter
                  {totalLoading && (
                    <span className="ml-1 inline-flex items-center gap-1 text-[10px] opacity-70">
                      <Loader2 className="h-3 w-3 animate-spin" /> menghitung…
                    </span>
                  )}
                  {" · "}
                  <span className="tabular-nums">{loaded}</span> dimuat dari <span className="tabular-nums">{total}</span> total
                </>
              ) : (
                <>
                  Menampilkan <b className="tabular-nums">{shown}</b> dari{" "}
                  <b className="tabular-nums">{total}</b> total
                  {loaded < total && (
                    <> · <span className="tabular-nums">{loaded}</span> dimuat</>
                  )}
                </>
              )}
              {!totalLoading && remaining > 0 && (
                <> · <span className="tabular-nums">{remaining}</span> belum tampil</>
              )}
              {sort === "status" && hasMore && (
                <> · <span className="text-amber-600 dark:text-amber-400">urutan status berdasarkan data yang dimuat</span></>
              )}
            </>
          );
        })()}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari judul atau token…"
            className="h-9 w-full rounded-md border bg-background pl-7 pr-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>
        <label className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-2 text-xs">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Urutkan:</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="bg-transparent text-xs font-medium focus:outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-1">
          {([
            ["all", "Semua"],
            ["active", "Aktif"],
            ["expired", "Kedaluwarsa"],
            ["done", "Selesai"],
            ["cancelled", "Dibatalkan"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] ${
                filter === key ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
              }`}
            >
              {label} <span className="rounded bg-muted px-1 text-[10px] tabular-nums">{counts[key] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1">
        <span className="mr-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Token:
        </span>
        {([
          ["all", "Semua", ""],
          ["valid", "Valid", "data-[active=true]:border-emerald-500/50 data-[active=true]:bg-emerald-500/10 data-[active=true]:text-emerald-700 dark:data-[active=true]:text-emerald-400"],
          ["fresh", "Baru dibuat", "data-[active=true]:border-sky-500/50 data-[active=true]:bg-sky-500/10 data-[active=true]:text-sky-700 dark:data-[active=true]:text-sky-400"],
          ["invalid", "Invalid", "data-[active=true]:border-amber-500/50 data-[active=true]:bg-amber-500/10 data-[active=true]:text-amber-700 dark:data-[active=true]:text-amber-400"],
          ["empty", "Kosong", "data-[active=true]:border-destructive/50 data-[active=true]:bg-destructive/10 data-[active=true]:text-destructive"],
        ] as const).map(([key, label, activeCls]) => {
          const active = tokenFilter === key;
          return (
            <button
              key={key}
              data-active={active}
              onClick={() => setTokenFilter(key)}
              className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] hover:bg-muted ${activeCls} ${
                active && !activeCls ? "border-primary bg-primary/10 text-primary" : ""
              }`}
            >
              {label} <span className="rounded bg-muted px-1 text-[10px] tabular-nums">{tokenCounts[key] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-3 relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={tokenKw}
          onChange={(e) => setTokenKw(e.target.value)}
          placeholder={
            tokenFilter === "all"
              ? "Cari nama atau ID pegawai…"
              : `Cari nama atau ID pegawai dalam status “${
                  tokenFilter === "valid" ? "Valid" : tokenFilter === "fresh" ? "Baru dibuat" : tokenFilter === "invalid" ? "Invalid" : "Kosong"
                }”…`
          }
          className="h-9 w-full rounded-md border bg-background pl-7 pr-8 text-sm focus:border-primary focus:outline-none"
        />
        {tokenKw && (
          <button
            type="button"
            onClick={() => setTokenKw("")}
            aria-label="Bersihkan pencarian"
            className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            ×
          </button>
        )}
      </div>

      {tasks === null ? (
        <div className="rounded-xl border bg-card p-6 text-center text-xs text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Memuat…
        </div>
      ) : loadError && tasks.length === 0 ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-center">
          <AlertTriangle className="mx-auto mb-2 h-5 w-5 text-destructive" />
          <div className="text-sm font-medium text-destructive">Gagal memuat daftar link</div>
          <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
            {loadError}
          </p>
          <button
            onClick={() => void reload()}
            disabled={busy}
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            Coba lagi
          </button>
        </div>
      ) : rows.length === 0 ? (
        <>
          <div className="rounded-xl border bg-card p-6 text-center text-xs text-muted-foreground">
            Tidak ada tugas{filter !== "all" ? ` dengan status “${BADGE[filter as Availability].label}”` : ""} pada {tasks.length} entri yang dimuat.
          </div>
          {hasMore && (
            <div className="mt-3 flex justify-center">
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="inline-flex h-9 items-center gap-1 rounded-md border bg-background px-3 text-xs hover:bg-muted disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Muat lebih banyak untuk mencari
              </button>
            </div>
          )}
        </>
      ) : (
        <>
        <div className="space-y-2">
          {rows.map(({ t, avail }) => {
            const tokenValid = isValidShareToken(t.share_token);
            let url = "";
            let urlError: string | null = null;
            if (tokenValid) {
              try {
                url = publicTaskUrl(t.share_token);
              } catch (e) {
                urlError = e instanceof InvalidShareTokenError ? e.message : "Token link tidak valid";
              }
            } else {
              urlError = !t.share_token ? "Token link kosong — link tidak bisa dibuat" : "Token link tidak valid — minta pemilik membuat ulang tugas ini";
            }
            const badge = BADGE[avail];
            const expiresAt = new Date(t.expires_at);
            const openable = (avail === "active" || avail === "done") && !urlError;
            const tokenState = classifyToken(t.share_token, regenAt[t.id], now);
            const msToExpire = expiresAt.getTime() - now;
            const countdown = formatCountdown(msToExpire);
            const countdownTone =
              countdown.tone === "danger"
                ? "bg-destructive/10 text-destructive ring-destructive/20"
                : countdown.tone === "warn"
                ? "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400"
                : "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400";
            return (
              <div key={t.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="flex items-start gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="truncate text-sm font-semibold">{t.title}</div>
                      <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {testMode && (
                        <>
                          {tokenState.kind === "valid" && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-400">
                              <ShieldCheck className="h-3 w-3" /> Valid
                            </span>
                          )}
                          {tokenState.kind === "fresh" && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-sky-500/20 dark:text-sky-400">
                              <Sparkles className="h-3 w-3" /> Baru · {Math.max(1, Math.floor(tokenState.ageMs / 1000))}d lalu
                            </span>
                          )}
                          {tokenState.kind === "invalid" && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400">
                              <AlertTriangle className="h-3 w-3" /> Invalid
                            </span>
                          )}
                          {tokenState.kind === "empty" && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive ring-1 ring-destructive/20">
                              <CircleSlash className="h-3 w-3" /> Kosong
                            </span>
                          )}
                          <span className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 tabular-nums ${countdownTone}`}>
                            <Timer className="h-3 w-3" /> {countdown.text}
                          </span>
                        </>
                      )}
                    </div>
                    {t.note && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground whitespace-pre-wrap">{t.note}</div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>Dibuat: {new Date(t.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</span>
                      <span>Kedaluwarsa: {expiresAt.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</span>
                    </div>
                    {urlError ? (
                      <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive ring-1 ring-destructive/20">
                        ⚠ {urlError}
                      </div>
                    ) : (
                      <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={url}>{url}</div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t bg-muted/30 px-3 py-2">
                  <a
                    href={openable ? url : undefined}
                    onClick={(e) => {
                      if (!openable) {
                        e.preventDefault();
                        toast.error(urlError ?? `Link ${badge.label.toLowerCase()} — tidak bisa dibuka`);
                      }
                    }}
                    target="_blank"
                    rel="noreferrer"
                    aria-disabled={!openable}
                    className={`inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-medium ${
                      openable
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "cursor-not-allowed border bg-background text-muted-foreground"
                    }`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Buka di Tab Baru
                  </a>
                  <button
                    onClick={() => {
                      if (urlError) { toast.error(urlError); return; }
                      void copyLink(url);
                    }}
                    className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2 text-[11px] hover:bg-muted"
                  >
                    <Copy className="h-3.5 w-3.5" /> Salin Link
                  </button>
                  {urlError && (
                    <button
                      onClick={() => void regenerateToken(t.id)}
                      disabled={regenId === t.id}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      {regenId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                      Buat Ulang Token
                    </button>
                  )}
                  {availability === "expired" && (
                    <button
                      onClick={() => void regenerateToken(t.id, { extendDays: 7 })}
                      disabled={regenId === t.id}
                      title="Perpanjang masa aktif 7 hari & terbitkan token baru"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-400"
                    >
                      {regenId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                      Perpanjang &amp; Token Baru (7 hari)
                    </button>
                  )}
                  {testMode && !urlError && (
                    <button
                      onClick={() => void regenerateToken(t.id)}
                      disabled={regenId === t.id}
                      title="Buat token baru untuk pengujian"
                      className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2 text-[11px] hover:bg-muted disabled:opacity-50"
                    >
                      {regenId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                      Token Baru
                    </button>
                  )}
                  <button
                    onClick={() => openResetPin(t)}
                    title="Buat PIN baru — PIN lama otomatis tidak berlaku"
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
                  >
                    <LockKeyhole className="h-3.5 w-3.5" /> Reset PIN
                  </button>
                  <Link
                    to="/tugas"
                    className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2 text-[11px] hover:bg-muted"
                  >
                    Kelola di Tugas Pegawai
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
        <div ref={sentinelRef} className="h-1" aria-hidden />
        <div className="mt-3 flex items-center justify-center">
          {loadingMore ? (
            <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat lebih banyak…
            </div>
          ) : hasMore ? (
            <button
              onClick={() => void loadMore()}
              className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-[11px] hover:bg-muted"
            >
              Muat lebih banyak
            </button>
          ) : (
            <div className="text-[11px] text-muted-foreground">Semua tugas sudah ditampilkan.</div>
          )}
        </div>
        </>
      )}

      <Dialog
        open={!!resetTask}
        onOpenChange={(v) => {
          if (!v) { setResetTask(null); setResetPin(""); setResetDone(false); }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-amber-600" /> Reset PIN
            </DialogTitle>
            <DialogDescription>
              {resetDone
                ? "PIN baru aktif. Catat atau kirim sekarang — PIN tidak bisa dilihat lagi setelah dialog ditutup."
                : `Buat PIN baru (4–8 digit) untuk "${resetTask?.title ?? ""}". PIN lama akan langsung tidak berlaku.`}
            </DialogDescription>
          </DialogHeader>

          {!resetDone ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  maxLength={8}
                  value={resetPin}
                  onChange={(e) => setResetPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="4–8 digit"
                  className="tracking-[0.3em] text-center font-mono text-base"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setResetPin(genPin())}
                  title="Acak PIN"
                >
                  <Dices className="h-4 w-4" /> Acak
                </Button>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setResetTask(null)}>Batal</Button>
                <Button onClick={() => void submitResetPin()} disabled={resetBusy}>
                  {resetBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Simpan PIN Baru
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">PIN Baru</div>
                <div className="mt-1 font-mono text-2xl tracking-[0.4em]">{resetPin}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => void copyPin()}>
                  <Copy className="h-4 w-4" /> Salin
                </Button>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-600/90" onClick={() => void sharePinToWa()}>
                  <MessageCircle className="h-4 w-4" /> Kirim WA
                </Button>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => { setResetTask(null); setResetPin(""); setResetDone(false); }}>
                  Selesai
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}