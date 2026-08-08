import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAdminStatus } from "@/hooks/use-is-admin";
import { ArrowLeft, ShieldAlert, RefreshCw, CheckCircle2, XCircle, MinusCircle, Package } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/dependensi")({
  head: () => ({
    meta: [
      { title: "Tren Dependency & Status Audit · Ace Storage" },
      { name: "description", content: "Dashboard tren update dependency per minggu dan status audit paket @tanstack/* serta router-plugin." },
      { property: "og:title", content: "Tren Dependency & Status Audit · Ace Storage" },
      { property: "og:description", content: "Pantau update dependency mingguan dan hasil audit versi router." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DependencyTrendPage,
});

type GroupId = "tanstack" | "router-plugin" | "lainnya";

type Change = { name: string; from: string | null; to: string | null; group: GroupId; date: string };

type Week = { week: string; start: string; tanstack: number; "router-plugin": number; lainnya: number; changes: Change[] };

type TrendData = {
  generatedAt: string;
  gitAvailable: boolean;
  weeks: Week[];
  groups: { id: GroupId; label: string }[];
  audits: {
    routerVersions: { ok: boolean; versions: Record<string, string>; errors: string[]; warnings: string[] };
    dependencies: { ok: boolean; skipped: boolean; output: string };
  };
};

const GROUP_TONE: Record<GroupId, string> = {
  tanstack: "bg-primary",
  "router-plugin": "bg-amber-500",
  lainnya: "bg-muted-foreground/50",
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

function StatusPill({ state, label }: { state: "ok" | "fail" | "skip"; label: string }) {
  const Icon = state === "ok" ? CheckCircle2 : state === "fail" ? XCircle : MinusCircle;
  const tone =
    state === "ok"
      ? "border-primary/40 bg-primary/10 text-primary"
      : state === "fail"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-ms-1 rounded-full border px-ms-2 py-1 text-ms-xs font-semibold ${tone}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </span>
  );
}

function DependencyTrendPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const [data, setData] = useState<TrendData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openWeek, setOpenWeek] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/data/dependency-trend.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Data tren belum tersedia (HTTP ${res.status}). Jalankan \`bun run build:dep-trend\`.`);
      setData((await res.json()) as TrendData);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [isAdmin]);

  const max = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.weeks.map((w) => w.tanstack + w["router-plugin"] + w.lainnya));
  }, [data]);

  const totals = useMemo(() => {
    const base = { tanstack: 0, "router-plugin": 0, lainnya: 0 } as Record<GroupId, number>;
    for (const w of data?.weeks ?? []) {
      base.tanstack += w.tanstack;
      base["router-plugin"] += w["router-plugin"];
      base.lainnya += w.lainnya;
    }
    return base;
  }, [data]);

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

  const routerAudit = data?.audits.routerVersions;
  const depAudit = data?.audits.dependencies;

  return (
    <div className="mx-auto max-w-4xl space-ms-4 p-ms-4">
      <div className="flex items-center justify-between gap-ms-2">
        <div>
          <h1 className="text-ms-lg font-semibold">Tren Dependency & Audit</h1>
          <p className="text-ms-xs text-muted-foreground">
            Update paket per minggu dan status audit untuk @tanstack/* serta router-plugin.
          </p>
        </div>
        <div className="flex items-center gap-ms-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden="true" /> Muat ulang
          </button>
          <Link to="/" className="inline-flex items-center gap-ms-1 rounded-md border px-ms-2 py-1 text-ms-xs hover:bg-accent">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Beranda
          </Link>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-ms-3 text-ms-sm text-destructive">{err}</div>
      )}

      {data && (
        <>
          <section aria-labelledby="status-audit" className="grid gap-ms-2 sm:grid-cols-2">
            <h2 id="status-audit" className="sr-only">Status audit</h2>
            <div className="rounded-lg border bg-card p-ms-3">
              <div className="mb-ms-2 flex items-center justify-between gap-ms-2">
                <span className="text-ms-sm font-semibold">Audit versi router</span>
                <StatusPill state={routerAudit?.ok ? "ok" : "fail"} label={routerAudit?.ok ? "Lulus" : "Gagal"} />
              </div>
              <dl className="space-y-1 text-ms-xs">
                {Object.entries(routerAudit?.versions ?? {}).map(([name, version]) => (
                  <div key={name} className="flex items-center justify-between gap-ms-2">
                    <dt className="truncate text-muted-foreground">{name}</dt>
                    <dd className="font-mono">{version}</dd>
                  </div>
                ))}
              </dl>
              {(routerAudit?.errors.length ?? 0) > 0 && (
                <ul className="mt-ms-2 list-disc space-y-1 pl-4 text-ms-xs text-destructive">
                  {routerAudit?.errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              )}
              {(routerAudit?.warnings.length ?? 0) > 0 && (
                <ul className="mt-ms-2 list-disc space-y-1 pl-4 text-ms-xs text-muted-foreground">
                  {routerAudit?.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              )}
            </div>

            <div className="rounded-lg border bg-card p-ms-3">
              <div className="mb-ms-2 flex items-center justify-between gap-ms-2">
                <span className="text-ms-sm font-semibold">Audit kerentanan paket</span>
                <StatusPill
                  state={depAudit?.skipped ? "skip" : depAudit?.ok ? "ok" : "fail"}
                  label={depAudit?.skipped ? "Dilewati" : depAudit?.ok ? "Lulus" : "Gagal"}
                />
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-ms-2 text-ms-xs text-muted-foreground">
                {depAudit?.output || "(tidak ada output)"}
              </pre>
            </div>
          </section>

          <section aria-labelledby="tren-mingguan" className="rounded-lg border bg-card p-ms-3">
            <div className="mb-ms-3 flex flex-wrap items-center justify-between gap-ms-2">
              <h2 id="tren-mingguan" className="text-ms-sm font-semibold">Tren update per minggu</h2>
              <div className="flex flex-wrap items-center gap-ms-3 text-ms-xs text-muted-foreground">
                {data.groups.map((g) => (
                  <span key={g.id} className="inline-flex items-center gap-ms-1">
                    <span className={`h-2.5 w-2.5 rounded-sm ${GROUP_TONE[g.id]}`} aria-hidden="true" />
                    {g.label} ({totals[g.id]})
                  </span>
                ))}
              </div>
            </div>

            {data.weeks.length === 0 ? (
              <p className="text-ms-sm text-muted-foreground">
                {data.gitAvailable
                  ? "Belum ada perubahan dependency yang tercatat."
                  : "Riwayat git tidak tersedia di lingkungan build ini."}
              </p>
            ) : (
              <ul className="space-y-ms-2">
                {data.weeks.map((w) => {
                  const total = w.tanstack + w["router-plugin"] + w.lainnya;
                  const open = openWeek === w.week;
                  return (
                    <li key={w.week} className="rounded-md border bg-background p-ms-2">
                      <button
                        type="button"
                        onClick={() => setOpenWeek(open ? null : w.week)}
                        aria-expanded={open}
                        className="flex w-full items-center gap-ms-2 text-left"
                      >
                        <span className="w-28 shrink-0 text-ms-xs text-muted-foreground">
                          {w.week}
                          <span className="block">{fmtDate(w.start)}</span>
                        </span>
                        <span className="flex h-3 flex-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${total} perubahan pada ${w.week}`}>
                          {(["tanstack", "router-plugin", "lainnya"] as GroupId[]).map((g) =>
                            w[g] > 0 ? (
                              <span key={g} className={GROUP_TONE[g]} style={{ width: `${(w[g] / max) * 100}%` }} />
                            ) : null,
                          )}
                        </span>
                        <span className="w-10 shrink-0 text-right text-ms-sm font-semibold tabular-nums">{total}</span>
                      </button>

                      {open && (
                        <ul className="mt-ms-2 space-y-1 border-t pt-ms-2 text-ms-xs">
                          {w.changes.map((c, i) => (
                            <li key={`${c.name}-${i}`} className="flex items-center justify-between gap-ms-2">
                              <span className="inline-flex min-w-0 items-center gap-ms-1">
                                <span className={`h-2 w-2 shrink-0 rounded-sm ${GROUP_TONE[c.group]}`} aria-hidden="true" />
                                <Package className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span className="truncate">{c.name}</span>
                              </span>
                              <span className="shrink-0 font-mono text-muted-foreground">
                                {c.from ?? "baru"} → {c.to ?? "dihapus"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <p className="text-ms-xs text-muted-foreground">
            Data dibuat {fmtDate(data.generatedAt)} oleh <code>bun run build:dep-trend</code> (dijalankan tiap build).
          </p>
        </>
      )}
    </div>
  );
}
