import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminStatus } from "@/hooks/use-is-admin";
import {
  ArrowLeft,
  ShieldAlert,
  RefreshCw,
  Search,
  XCircle,
  ShieldOff,
  ShieldQuestion,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/turnstile-audit")({
  head: () => ({
    meta: [
      { title: "Audit Turnstile · MCM Storage" },
      {
        name: "description",
        content:
          "Riwayat percobaan pendaftaran yang gagal verifikasi CAPTCHA Turnstile, beserta error-code dari Cloudflare.",
      },
    ],
  }),
  component: TurnstileAuditPage,
});

type Row = {
  id: number;
  ip: string;
  email: string | null;
  created_at: string;
  user_agent: string | null;
  failure_code: string | null;
  failure_details: string | null;
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function toIsoStart(d: string): string | null {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}
function toIsoEnd(d: string): string | null {
  if (!d) return null;
  const dt = new Date(`${d}T23:59:59.999`);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

type CodeFilter = "all" | "captcha_failed" | "captcha_missing";

/**
 * Rangkuman error-code Turnstile dari Cloudflare untuk membantu diagnosis
 * cepat. Sumber: https://developers.cloudflare.com/turnstile/reference/error-codes
 */
const ERROR_CODE_HINTS: Record<string, string> = {
  "missing-input-secret": "Server tidak mengirim secret — cek env/DB.",
  "invalid-input-secret": "Secret key salah/tidak dikenal.",
  "missing-input-response": "Token dari client kosong.",
  "invalid-input-response": "Token dari client tidak valid/kedaluwarsa.",
  "bad-request": "Request malformed ke Cloudflare.",
  "timeout-or-duplicate": "Token sudah dipakai atau kedaluwarsa (>5 menit).",
  "internal-error": "Cloudflare bermasalah — coba lagi nanti.",
  "invalid-hostname":
    "Hostname belum di-allowlist di dashboard Turnstile widget.",
  network_error: "Server gagal menghubungi Cloudflare (jaringan).",
};

function hintFor(details: string | null): string | null {
  if (!details) return null;
  const codes = details
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const hints = codes
    .map((c) => ERROR_CODE_HINTS[c])
    .filter((v): v is string => Boolean(v));
  return hints.length ? hints.join(" ") : null;
}

function TurnstileAuditPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [codeFilter, setCodeFilter] = useState<CodeFilter>("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(200);

  async function load() {
    setBusy(true);
    setErr(null);
    let query = supabase
      .from("signup_attempts")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select(
        "id,ip,email,created_at,user_agent,failure_code,failure_details" as any,
      )
      .in("failure_code", ["captcha_failed", "captcha_missing"])
      .order("created_at", { ascending: false })
      .limit(limit);
    const iso1 = toIsoStart(from);
    const iso2 = toIsoEnd(to);
    if (iso1) query = query.gte("created_at", iso1);
    if (iso2) query = query.lte("created_at", iso2);
    if (codeFilter !== "all") query = query.eq("failure_code", codeFilter);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (query as any);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setRows((data ?? []) as Row[]);
  }

  useEffect(() => {
    if (!isAdmin) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, from, to, codeFilter, limit]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        (r.email ?? "").toLowerCase().includes(needle) ||
        r.ip.toLowerCase().includes(needle) ||
        (r.user_agent ?? "").toLowerCase().includes(needle) ||
        (r.failure_details ?? "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const failed = filtered.filter((r) => r.failure_code === "captcha_failed").length;
    const missing = filtered.filter((r) => r.failure_code === "captcha_missing").length;
    return { total, failed, missing };
  }, [filtered]);

  if (isCheckingAdmin) {
    return (
      <div className="mx-auto max-w-4xl px-3 py-8 text-center text-sm text-muted-foreground">
        Memeriksa izin akses…
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-3 py-6">
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5 text-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold text-destructive">
            <ShieldAlert className="h-5 w-5" /> Akses ditolak
          </div>
          <p>Halaman ini hanya untuk admin.</p>
          <div className="mt-3">
            <Link
              to="/"
              className="inline-flex h-9 items-center gap-1 rounded-md border bg-background px-3 text-xs font-semibold"
            >
              <ArrowLeft className="h-4 w-4" /> Beranda
            </Link>
          </div>
        </div>
      </div>
    );
  }

  function resetFilters() {
    setFrom("");
    setTo("");
    setCodeFilter("all");
    setQ("");
    setLimit(200);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Audit Turnstile</h1>
          <p className="text-xs text-muted-foreground">
            Percobaan pendaftaran yang gagal verifikasi CAPTCHA — untuk mendeteksi
            bot, salah konfigurasi hostname, atau secret yang tidak valid.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            to="/admin/turnstile"
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
          >
            Pengaturan
          </Link>
          <Link
            to="/admin/signup-attempts"
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
          >
            Semua signup
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 sm:grid-cols-5">
        <label className="col-span-1 space-y-1 text-xs">
          <span className="text-muted-foreground">Dari tanggal</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="col-span-1 space-y-1 text-xs">
          <span className="text-muted-foreground">Sampai tanggal</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="col-span-1 space-y-1 text-xs">
          <span className="text-muted-foreground">Kode kegagalan</span>
          <select
            value={codeFilter}
            onChange={(e) => setCodeFilter(e.target.value as CodeFilter)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="all">Semua</option>
            <option value="captcha_failed">captcha_failed</option>
            <option value="captcha_missing">captcha_missing</option>
          </select>
        </label>
        <label className="col-span-1 space-y-1 text-xs">
          <span className="text-muted-foreground">Batas baris</span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </label>
        <div className="col-span-2 flex items-end gap-1.5 sm:col-span-1">
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />{" "}
            Muat ulang
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
          >
            Reset
          </button>
        </div>
        <div className="col-span-2 sm:col-span-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari email, IP, user agent, atau error-code…"
              className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-md bg-muted px-2 py-0.5">
          Total: <b>{stats.total}</b>
        </span>
        <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-destructive">
          captcha_failed: <b>{stats.failed}</b>
        </span>
        <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-300">
          captcha_missing: <b>{stats.missing}</b>
        </span>
      </div>

      {err ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Gagal memuat: {err}
        </div>
      ) : null}

      {rows === null ? (
        <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          Memuat…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          Tidak ada kegagalan Turnstile yang cocok filter.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="min-w-full text-sm">
            <thead className="border-b bg-muted/50 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Waktu</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">IP</th>
                <th className="px-3 py-2 text-left">Kode</th>
                <th className="px-3 py-2 text-left">Error-code Cloudflare</th>
                <th className="px-3 py-2 text-left">User agent</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const hint = hintFor(r.failure_details);
                const isMissing = r.failure_code === "captcha_missing";
                const Icon = isMissing ? ShieldQuestion : ShieldOff;
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-[12px]">
                      {fmt(r.created_at)}
                    </td>
                    <td className="px-3 py-1.5 text-[12px]">
                      {r.email ?? (
                        <span className="text-muted-foreground italic">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{r.ip}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={
                          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium " +
                          (isMissing
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            : "bg-destructive/10 text-destructive")
                        }
                      >
                        <Icon className="h-3 w-3" />
                        {r.failure_code}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[11px] max-w-[280px]">
                      {r.failure_details ? (
                        <>
                          <code className="font-mono">{r.failure_details}</code>
                          {hint && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {hint}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground italic">
                          <XCircle className="h-3 w-3" /> (tidak ada)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-muted-foreground max-w-[260px]">
                      {r.user_agent ? (
                        <span
                          className="line-clamp-2 break-words"
                          title={r.user_agent}
                        >
                          {r.user_agent}
                        </span>
                      ) : (
                        <span className="italic">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
