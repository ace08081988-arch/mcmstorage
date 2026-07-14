import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAdminStatus } from "@/hooks/use-is-admin";
import { useServerFn } from "@tanstack/react-start";
import { listSignupAttempts, type SignupAttemptRow } from "@/lib/signup-attempts.functions";
import { ArrowLeft, ShieldAlert, RefreshCw, Search, CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/signup-attempts")({
  head: () => ({
    meta: [
      { title: "Log Signup Attempts · MCM Storage" },
      { name: "description", content: "Audit percobaan pendaftaran (email, IP, status) untuk admin." },
    ],
  }),
  component: SignupAttemptsPage,
});

type Attempt = SignupAttemptRow;

type StatusFilter = "all" | "success" | "failed";

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return iso; }
}

function SignupAttemptsPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const listFn = useServerFn(listSignupAttempts);
  const [rows, setRows] = useState<Attempt[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(200);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const res = await listFn({ data: { from, to, status, limit } });
      setBusy(false);
      if (!res.isAdmin) { setErr("Akses ditolak"); return; }
      setRows(res.rows);
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, from, to, status, limit]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      (r.email ?? "").toLowerCase().includes(needle) ||
      r.ip.toLowerCase().includes(needle) ||
      (r.user_agent ?? "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const ok = filtered.filter((r) => r.succeeded).length;
    return { total, ok, fail: total - ok };
  }, [filtered]);

  if (isCheckingAdmin) {
    return <div className="mx-auto max-w-4xl px-ms-3 py-8 text-center text-ms-sm text-muted-foreground">Memeriksa izin akses…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-ms-3 py-ms-6">
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-ms-5 text-ms-sm">
          <div className="mb-2 flex items-center gap-ms-2 font-semibold text-destructive">
            <ShieldAlert className="h-5 w-5" /> Akses ditolak
          </div>
          <p>Halaman ini hanya untuk admin.</p>
          <div className="mt-3">
            <Link to="/" className="inline-flex h-9 items-center gap-ms-1 rounded-md border bg-background px-ms-3 text-ms-xs font-semibold">
              <ArrowLeft className="h-4 w-4" /> Beranda
            </Link>
          </div>
        </div>
      </div>
    );
  }

  function resetFilters() {
    setFrom(""); setTo(""); setStatus("all"); setQ(""); setLimit(200);
  }

  return (
    <div className="mx-auto max-w-4xl space-ms-4 p-ms-4">
      <div className="flex items-center justify-between gap-ms-2">
        <div>
          <h1 className="text-ms-lg font-semibold">Log Signup Attempts</h1>
          <p className="text-ms-xs text-muted-foreground">Percobaan pendaftaran akun — untuk audit rate-limit & anomali.</p>
        </div>
        <Link to="/" className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent">
          <ArrowLeft className="h-3.5 w-3.5" /> Beranda
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-ms-2 rounded-lg border bg-card p-ms-3 sm:grid-cols-5">
        <label className="col-span-1 space-y-1 text-ms-xs">
          <span className="text-muted-foreground">Dari tanggal</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" />
        </label>
        <label className="col-span-1 space-y-1 text-ms-xs">
          <span className="text-muted-foreground">Sampai tanggal</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm" />
        </label>
        <label className="col-span-1 space-y-1 text-ms-xs">
          <span className="text-muted-foreground">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm">
            <option value="all">Semua</option>
            <option value="success">Berhasil</option>
            <option value="failed">Gagal</option>
          </select>
        </label>
        <label className="col-span-1 space-y-1 text-ms-xs">
          <span className="text-muted-foreground">Batas baris</span>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-full rounded-md border bg-background px-ms-2 py-1.5 text-ms-sm">
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </label>
        <div className="col-span-2 flex items-end gap-ms-1.5 sm:col-span-1">
          <button type="button" onClick={() => void load()} disabled={busy} className="inline-flex flex-1 items-center justify-center gap-ms-1 rounded-md border bg-background px-ms-2 py-1.5 text-ms-xs hover:bg-accent disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Muat ulang
          </button>
          <button type="button" onClick={resetFilters} className="rounded-md border px-ms-2 py-1.5 text-ms-xs hover:bg-accent">Reset</button>
        </div>
        <div className="col-span-2 sm:col-span-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari email, IP, atau user agent…" className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-ms-sm" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-ms-2 text-ms-2xs">
        <span className="rounded-md bg-muted px-ms-2 py-0.5">Total: <b>{stats.total}</b></span>
        <span className="rounded-md bg-emerald-500/15 px-ms-2 py-0.5 text-emerald-700 dark:text-emerald-200">Berhasil: <b>{stats.ok}</b></span>
        <span className="rounded-md bg-destructive/10 px-ms-2 py-0.5 text-destructive">Gagal: <b>{stats.fail}</b></span>
      </div>

      {err ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-ms-3 text-ms-xs text-destructive">Gagal memuat: {err}</div>
      ) : null}

      {rows === null ? (
        <div className="rounded-lg border bg-card p-ms-6 text-center text-ms-sm text-muted-foreground">Memuat…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-ms-6 text-center text-ms-sm text-muted-foreground">
          Tidak ada percobaan pendaftaran yang cocok.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="min-w-full text-ms-sm">
            <thead className="border-b bg-muted/50 text-ms-2xs uppercase text-muted-foreground">
              <tr>
                <th className="px-ms-3 py-ms-2 text-left">Waktu</th>
                <th className="px-ms-3 py-ms-2 text-left">Email</th>
                <th className="px-ms-3 py-ms-2 text-left">IP</th>
                <th className="px-ms-3 py-ms-2 text-left">Status</th>
                <th className="px-ms-3 py-ms-2 text-left">User agent</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-ms-3 py-1.5 whitespace-nowrap tabular-nums text-ms-xs">{fmt(r.created_at)}</td>
                  <td className="px-ms-3 py-1.5 text-ms-xs">{r.email ?? <span className="text-muted-foreground italic">—</span>}</td>
                  <td className="px-ms-3 py-1.5 font-mono text-ms-2xs">{r.ip}</td>
                  <td className="px-ms-3 py-1.5">
                    {r.succeeded ? (
                      <span className="inline-flex items-center gap-ms-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-ms-2xs font-medium text-emerald-700 dark:text-emerald-200">
                        <CheckCircle2 className="h-3 w-3" /> Berhasil
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-ms-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-ms-2xs font-medium text-destructive">
                        <XCircle className="h-3 w-3" /> Gagal
                      </span>
                    )}
                  </td>
                  <td className="px-ms-3 py-1.5 text-ms-2xs text-muted-foreground max-w-[280px]">
                    {r.user_agent ? (
                      <span className="line-clamp-2 break-words" title={r.user_agent}>{r.user_agent}</span>
                    ) : (
                      <span className="italic">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
