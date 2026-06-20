import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { publicTaskUrl } from "@/lib/prep";
import { ExternalLink, Copy, Link2, Search, RefreshCw, ChevronLeft } from "lucide-react";

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

function LinkPegawaiPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Availability>("all");
  const [now, setNow] = useState(Date.now());

  async function load() {
    setBusy(true);
    const { data, error } = await supabase
      .from("prep_tasks")
      .select("id,title,note,share_token,status,expires_at,created_at")
      .order("created_at", { ascending: false });
    setBusy(false);
    if (error) { toast.error("Gagal memuat: " + error.message); return; }
    setTasks((data ?? []) as Task[]);
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

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
    return filtered;
  }, [tasks, q, filter, now]);

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
          onClick={() => void load()}
          disabled={busy}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Muat ulang
        </button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Semua tugas pegawai yang sudah pernah dibuat — link, status ketersediaan, dan akses langsung untuk pratinjau.
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
        <div className="rounded-xl border bg-card p-6 text-center text-xs text-muted-foreground">
          Tidak ada tugas{filter !== "all" ? ` dengan status “${BADGE[filter as Availability].label}”` : ""}.
        </div>
      ) : (
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
      )}
    </div>
  );
}