import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStatus } from "@/hooks/use-is-admin";
import { copyText } from "@/lib/share-wa";
import { publicTaskUrl } from "@/lib/prep";
import { ArrowLeft, CalendarClock, ShieldAlert, Copy, ExternalLink, Search, Plus, StickyNote, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tugas-daftar")({
  head: () => ({
    meta: [
      { title: "Daftar Tugas Penyiapan · MCM Storage" },
      { name: "description", content: "Ringkasan tugas penyiapan pegawai: tanggal dibuat, jadwal, dan catatan." },
    ],
  }),
  component: TugasDaftarPage,
});

type Task = {
  id: string;
  title: string;
  note: string | null;
  share_token: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  completed_at: string | null;
  completion_note: string | null;
  expires_at: string;
};

type FilterMode = "all" | "scheduled" | "unscheduled" | "active" | "done";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function scheduleBadge(scheduled: string | null): { label: string; className: string } {
  if (!scheduled) {
    return { label: "Tanpa jadwal", className: "bg-muted text-muted-foreground" };
  }
  const t = new Date(scheduled).getTime();
  const now = Date.now();
  if (Number.isNaN(t)) return { label: "Jadwal tidak valid", className: "bg-destructive/15 text-destructive" };
  const diffH = (t - now) / 36e5;
  if (diffH < -1) return { label: "Lewat jadwal", className: "bg-destructive/15 text-destructive" };
  if (diffH < 0) return { label: "Sedang berjalan", className: "bg-warning/15 text-warning dark:text-warning" };
  if (diffH < 24) return { label: "Hari ini", className: "bg-success/15 text-success dark:text-success" };
  return { label: "Terjadwal", className: "bg-sky-500/15 text-sky-700 dark:text-sky-200" };
}

function statusBadge(status: string): { label: string; className: string } {
  const s = status.toLowerCase();
  if (s === "done") return { label: "Selesai", className: "bg-success/15 text-success dark:text-success" };
  if (s === "cancelled") return { label: "Dibatalkan", className: "bg-muted text-muted-foreground" };
  if (s === "expired") return { label: "Kedaluwarsa", className: "bg-destructive/10 text-destructive" };
  return { label: "Aktif", className: "bg-sky-500/15 text-sky-700 dark:text-sky-200" };
}

function TugasDaftarPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [refreshing, setRefreshing] = useState(false);
  // L3: guard "latest-wins" agar refresh cepat berturut-turut tidak
  // menimpa state dengan hasil request lama.
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const myReq = ++reqIdRef.current;
    setRefreshing(true);
    const { data, error } = await supabase
      .from("prep_tasks")
      .select("id,title,note,share_token,status,scheduled_at,created_at,completed_at,completion_note,expires_at")
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (myReq !== reqIdRef.current) return;
    if (error) { setLoadErr(error.message); setRefreshing(false); return; }
    setLoadErr(null);
    setTasks((data ?? []) as Task[]);
    setRefreshing(false);
  }, [isAdmin]);

  useEffect(() => { void load(); }, [load]);

  // L3: realtime — refresh daftar saat tugas dibuat/diubah/dihapus.
  // Cleanup channel aman untuk StrictMode double-mount.
  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase
      .channel("prep_tasks-daftar")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "prep_tasks" },
        () => { void load(); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [isAdmin, load]);

  const filtered = useMemo(() => {
    if (!tasks) return [];
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filter === "scheduled" && !t.scheduled_at) return false;
      if (filter === "unscheduled" && t.scheduled_at) return false;
      if (filter === "active" && t.status !== "active") return false;
      if (filter === "done" && t.status !== "done") return false;
      if (!needle) return true;
      const hay = [t.title, t.note ?? "", t.share_token].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [tasks, q, filter]);

  if (isCheckingAdmin) {
    return <div className="mx-auto max-w-3xl px-ms-3 py-8 text-center text-ms-sm text-muted-foreground">Memeriksa izin akses…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-ms-3 py-ms-6">
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-ms-5 text-ms-sm">
          <div className="mb-2 flex items-center gap-ms-2 font-semibold text-destructive">
            <ShieldAlert className="h-5 w-5" /> Akses ditolak
          </div>
          <p className="text-foreground">
            Halaman <b>Daftar Tugas Penyiapan</b> hanya bisa diakses oleh pengguna dengan peran <b>admin</b>.
          </p>
          <div className="mt-3">
            <Link to="/tugas" className="inline-flex h-9 items-center gap-ms-1 rounded-md border bg-background px-ms-3 text-ms-xs font-semibold">
              <ArrowLeft className="h-4 w-4" /> Kembali ke Penyiapan
            </Link>
          </div>
        </div>
      </div>
    );
  }

  async function handleCopy(token: string) {
    const url = publicTaskUrl(token);
    const res = await copyText(url);
    if (res.ok) toast.success("URL disalin", { description: url });
    else toast.error("Gagal menyalin URL");
  }

  return (
    <div className="mx-auto max-w-3xl space-ms-4 p-ms-4">
      <div className="flex items-center justify-between gap-ms-2">
        <div>
          <h1 className="text-ms-lg font-semibold">Daftar Tugas Penyiapan</h1>
          <p className="text-ms-xs text-muted-foreground">Ringkasan tugas yang Anda buat — tanggal, jadwal, dan catatan.</p>
        </div>
        <div className="flex items-center gap-ms-1.5">
          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing}
            className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent disabled:opacity-50"
            title="Muat ulang daftar tugas"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
          <Link to="/tugas-baru" className="inline-flex items-center gap-ms-1 rounded-md bg-primary px-ms-2.5 py-1.5 text-ms-xs font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-3.5 w-3.5" /> Tugas baru
          </Link>
          <Link to="/tugas" className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent">
            <ArrowLeft className="h-3.5 w-3.5" /> Penyiapan
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-ms-2 rounded-lg border bg-card p-ms-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari judul, catatan, atau token…"
            className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-ms-sm"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterMode)}
          className="rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm"
          aria-label="Filter jadwal / status"
        >
          <option value="all">Semua</option>
          <option value="scheduled">Terjadwal</option>
          <option value="unscheduled">Tanpa jadwal</option>
          <option value="active">Aktif</option>
          <option value="done">Selesai</option>
        </select>
      </div>

      {loadErr ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-ms-3 text-ms-xs text-destructive">
          Gagal memuat: {loadErr}
        </div>
      ) : null}

      {tasks === null ? (
        <div className="rounded-lg border bg-card p-ms-6 text-center text-ms-sm text-muted-foreground">Memuat…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-ms-6 text-center text-ms-sm text-muted-foreground">
          {tasks.length === 0
            ? "Belum ada tugas. Buat lewat tombol Tugas baru."
            : "Tidak ada tugas yang cocok dengan filter."}
        </div>
      ) : (
        <ul className="space-ms-2">
          {filtered.map((t) => {
            const sched = scheduleBadge(t.scheduled_at);
            const stat = statusBadge(t.status);
            const noteFull = (t.note ?? "").trim();
            const noteShort = noteFull.length > 140 ? noteFull.slice(0, 140).trimEnd() + "…" : noteFull;
            return (
              <li key={t.id} className="rounded-lg border bg-card p-ms-3 text-ms-sm">
                <div className="flex flex-wrap items-start justify-between gap-ms-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-ms-1.5 text-ms-2xs text-muted-foreground">
                      <span className="inline-flex items-center gap-ms-1">
                        <CalendarClock className="h-3 w-3" /> Dibuat {fmtDate(t.created_at)}
                      </span>
                      {t.scheduled_at ? (
                        <span className="inline-flex items-center gap-ms-1">
                          · Jadwal {fmtDate(t.scheduled_at)}
                        </span>
                      ) : null}
                      {t.completed_at ? (
                        <span className="inline-flex items-center gap-ms-1">· Selesai {fmtDate(t.completed_at)}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-ms-1">
                    <span className={`rounded-md px-1.5 py-0.5 text-ms-2xs font-medium ${sched.className}`}>{sched.label}</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-ms-2xs font-medium ${stat.className}`}>{stat.label}</span>
                  </div>
                </div>

                {noteShort ? (
                  <div className="mt-2 flex items-start gap-ms-1.5 rounded-md bg-muted/50 px-ms-2 py-1.5 text-ms-xs text-foreground/90">
                    <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <p className="whitespace-pre-wrap break-words">{noteShort}</p>
                  </div>
                ) : null}

                {t.completion_note && t.completion_note.trim().length > 0 ? (
                  <div className="mt-2 rounded-md border border-success/30 bg-success/10 px-ms-2 py-1.5 text-ms-xs text-success dark:text-success">
                    <div className="text-ms-2xs font-semibold uppercase tracking-wide">Catatan penyelesaian</div>
                    <p className="whitespace-pre-wrap break-words">{t.completion_note}</p>
                  </div>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-ms-1.5 text-ms-2xs">
                  <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-ms-2xs">{t.share_token}</code>
                  <button
                    type="button"
                    onClick={() => handleCopy(t.share_token)}
                    className="inline-flex items-center gap-ms-1 rounded-md border px-1.5 py-0.5 text-ms-2xs hover:bg-accent"
                    title="Salin URL pegawai"
                  >
                    <Copy className="h-3 w-3" /> Salin URL
                  </button>
                  <a
                    href={publicTaskUrl(t.share_token)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-ms-1 rounded-md border px-1.5 py-0.5 text-ms-2xs hover:bg-accent"
                    title="Buka URL pegawai"
                  >
                    <ExternalLink className="h-3 w-3" /> Buka
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {tasks && tasks.length > 0 ? (
        <div className="text-center text-ms-2xs text-muted-foreground">
          Menampilkan {filtered.length} dari {tasks.length} tugas.
        </div>
      ) : null}
    </div>
  );
}
