import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { publicTaskUrl } from "@/lib/prep";
import { ExternalLink, Copy, Link2, Search, RefreshCw, ChevronLeft, Loader2, ArrowUpDown } from "lucide-react";

const PAGE_SIZE = 30;

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
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Availability>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [now, setNow] = useState(Date.now());
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Server-side order direction: only "oldest" flips it; "status" keeps newest-first fetch.
  const serverAscending = sort === "oldest";

  const reload = useCallback(async () => {
    setBusy(true);
    const { data, error, count } = await supabase
      .from("prep_tasks")
      .select("id,title,note,share_token,status,expires_at,created_at", { count: "exact" })
      .order("created_at", { ascending: serverAscending })
      .range(0, PAGE_SIZE - 1);
    setBusy(false);
    if (error) { toast.error("Gagal memuat: " + error.message); return; }
    const rows = (data ?? []) as Task[];
    setTasks(rows);
    setTotal(count ?? rows.length);
    setHasMore(rows.length === PAGE_SIZE && (count == null || rows.length < count));
  }, [serverAscending]);

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
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

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
    const list = (tasks ?? []).map((t) => ({ t, avail: computeAvailability(t, now) }));
    const filtered = list.filter(({ t, avail }) => {
      if (filter !== "all" && avail !== filter) return false;
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
  }, [tasks, q, filter, now, sort]);

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, expired: 0, done: 0, cancelled: 0 } as Record<string, number>;
    for (const t of tasks ?? []) {
      const a = computeAvailability(t, now);
      c.all += 1;
      c[a] += 1;
    }
    return c;
  }, [tasks, now]);

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link disalin");
    } catch {
      toast.error("Gagal menyalin");
    }
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
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Semua tugas pegawai yang sudah pernah dibuat — link, status ketersediaan, dan akses langsung untuk pratinjau.
        {total != null && (() => {
          const loaded = tasks?.length ?? 0;
          const shown = rows.length;
          const isFiltered = filter !== "all" || q.trim().length > 0;
          const remaining = Math.max(0, total - loaded);
          return (
            <>
              {" · "}
              {isFiltered ? (
                <>
                  Menampilkan <b className="tabular-nums">{shown}</b> hasil dari{" "}
                  <b className="tabular-nums">{loaded}</b> dimuat
                </>
              ) : (
                <>
                  Menampilkan <b className="tabular-nums">{shown}</b> dari{" "}
                  <b className="tabular-nums">{loaded}</b> dimuat
                </>
              )}
              {" · Total "}
              <b className="tabular-nums">{total}</b>
              {remaining > 0 && (
                <> · <span className="tabular-nums">{remaining}</span> belum dimuat</>
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

      {tasks === null ? (
        <div className="rounded-xl border bg-card p-6 text-center text-xs text-muted-foreground">Memuat…</div>
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
            const url = publicTaskUrl(t.share_token);
            const badge = BADGE[avail];
            const expiresAt = new Date(t.expires_at);
            const openable = avail === "active" || avail === "done";
            return (
              <div key={t.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="flex items-start gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-semibold">{t.title}</div>
                      <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    {t.note && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground whitespace-pre-wrap">{t.note}</div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                      <span>Dibuat: {new Date(t.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</span>
                      <span>Kedaluwarsa: {expiresAt.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</span>
                    </div>
                    <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={url}>{url}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t bg-muted/30 px-3 py-2">
                  <a
                    href={openable ? url : undefined}
                    onClick={(e) => { if (!openable) { e.preventDefault(); toast.error(`Link ${badge.label.toLowerCase()} — tidak bisa dibuka`); } }}
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
                    onClick={() => void copyLink(url)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-2 text-[11px] hover:bg-muted"
                  >
                    <Copy className="h-3.5 w-3.5" /> Salin Link
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
    </div>
  );
}