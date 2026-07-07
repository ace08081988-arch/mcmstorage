import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ShieldAlert,
  Search,
  CheckCircle2,
  XCircle,
  MailCheck,
  MailX,
  Ban,
} from "lucide-react";
import { useAdminStatus } from "@/hooks/use-is-admin";
import {
  adminGetUserEmailStatus,
  type UserEmailStatus,
} from "@/lib/admin-email-status.functions";

export const Route = createFileRoute("/_authenticated/admin/email-status")({
  head: () => ({
    meta: [
      { title: "Status Verifikasi Email · MCM Storage" },
      {
        name: "description",
        content:
          "Cari user berdasarkan email untuk melihat status verifikasi dan log pengiriman email.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: EmailStatusPage,
});

function fmt(iso: string | null): string {
  if (!iso) return "—";
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

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "sent") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-200">
        <CheckCircle2 className="h-3 w-3" /> {status}
      </span>
    );
  }
  if (s === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-200">
        {status}
      </span>
    );
  }
  if (s === "suppressed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 dark:text-yellow-200">
        <Ban className="h-3 w-3" /> {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
      <XCircle className="h-3 w-3" /> {status}
    </span>
  );
}

function EmailStatusPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const getStatus = useServerFn(adminGetUserEmailStatus);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UserEmailStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await getStatus({ data: { email: trimmed, logLimit: 100 } });
      setResult(r);
      if (!r.found && r.logs.length === 0) {
        toast.info("User tidak ditemukan dan tidak ada log email.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

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

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Status Verifikasi Email</h1>
          <p className="text-xs text-muted-foreground">
            Cek status akun & log pengiriman email untuk alamat tertentu.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Beranda
        </Link>
      </div>

      <form
        onSubmit={search}
        className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Masukkan email user…"
            className="w-full rounded-md border bg-background pl-7 pr-2 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Mencari…" : "Cari"}
        </button>
      </form>

      {err ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {err}
        </div>
      ) : null}

      {result ? (
        <>
          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Status Akun</h2>
            {!result.found ? (
              <p className="text-sm text-muted-foreground">
                User dengan email <b>{result.email}</b> tidak ditemukan di
                sistem auth.
              </p>
            ) : (
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] uppercase text-muted-foreground">
                    Email
                  </dt>
                  <dd className="break-all">{result.email}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase text-muted-foreground">
                    User ID
                  </dt>
                  <dd className="font-mono text-[11px] break-all">
                    {result.userId}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase text-muted-foreground">
                    Verifikasi email
                  </dt>
                  <dd>
                    {result.emailConfirmedAt ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-200">
                        <MailCheck className="h-3.5 w-3.5" /> Terverifikasi ·{" "}
                        {fmt(result.emailConfirmedAt)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-200">
                        <MailX className="h-3.5 w-3.5" /> Belum diverifikasi
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase text-muted-foreground">
                    Terdaftar
                  </dt>
                  <dd>{fmt(result.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase text-muted-foreground">
                    Login terakhir
                  </dt>
                  <dd>{fmt(result.lastSignInAt)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase text-muted-foreground">
                    Suppression
                  </dt>
                  <dd>
                    {result.isSuppressed ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                        <Ban className="h-3.5 w-3.5" /> {result.suppressionReason ?? "diblokir"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Tidak</span>
                    )}
                  </dd>
                </div>
                {result.bannedUntil ? (
                  <div className="sm:col-span-2">
                    <dt className="text-[11px] uppercase text-muted-foreground">
                      Banned hingga
                    </dt>
                    <dd className="text-destructive">
                      {fmt(result.bannedUntil)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">
              Log Email ({result.logs.length})
            </h2>
            {result.logs.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
                Belum ada log pengiriman email untuk alamat ini.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="min-w-full text-sm">
                  <thead className="border-b bg-muted/50 text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Waktu</th>
                      <th className="px-3 py-2 text-left">Template</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.logs.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b last:border-0 hover:bg-accent/40"
                      >
                        <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-[12px]">
                          {fmt(row.created_at)}
                        </td>
                        <td className="px-3 py-1.5 text-[12px]">
                          {row.template_name ?? (
                            <span className="italic text-muted-foreground">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {statusBadge(row.status)}
                        </td>
                        <td className="px-3 py-1.5 text-[11px] text-muted-foreground max-w-[320px]">
                          {row.error_message ? (
                            <span
                              className="line-clamp-2 break-words"
                              title={row.error_message}
                            >
                              {row.error_message}
                            </span>
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
            <p className="text-[10px] text-muted-foreground">
              Log didedupe berdasarkan message_id (status terakhir per email).
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}