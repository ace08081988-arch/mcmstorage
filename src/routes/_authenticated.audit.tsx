import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ClipboardCheck, Play, CheckCircle2, XCircle, Loader2, Download, Trash2 } from "lucide-react";
import { COMPACT_MODE_EVENT } from "@/components/CompactModeToggle";
import { SecurityFindingsBanner } from "@/components/SecurityFindingsBanner";
import { StatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({
    meta: [
      { title: "Audit Rute · MCM Storage" },
      { name: "description", content: "Laporan otomatis status tiap menu/rute aplikasi pada Mode Ringkas & Mode Normal." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AuditPage,
});

type ModeLabel = "ringkas" | "normal";

type RouteEntry = { label: string; to: string };

const ROUTES: RouteEntry[] = [
  { label: "Beranda", to: "/" },
  { label: "Gudang & Supplier", to: "/gudang" },
  { label: "Penyiapan Ecer", to: "/ecer" },
  { label: "Penyiapan Request", to: "/request" },
  { label: "Penyiapan Produk", to: "/tugas" },
  { label: "Link Pegawai", to: "/link-pegawai" },
  { label: "Hutang & Piutang", to: "/hutang-piutang" },
  { label: "Pratinjau Label", to: "/label-preview" },
  { label: "Profil Akun", to: "/profil" },
  { label: "Pengaturan Kunci", to: "/pengaturan-kunci" },
  { label: "Chat", to: "/chat" },
];

type Status = "pending" | "running" | "ok" | "fail";

type Row = {
  to: string;
  label: string;
  status: Status;
  ms: number | null;
  error: string | null;
  at: string | null;
  mode: ModeLabel | null;
};

function nowIso() {
  return new Date().toISOString();
}

function currentMode(): ModeLabel {
  if (typeof document === "undefined") return "normal";
  return document.documentElement.classList.contains("compact") ? "ringkas" : "normal";
}

function AuditPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    ROUTES.map((r) => ({ to: r.to, label: r.label, status: "pending", ms: null, error: null, at: null, mode: null })),
  );
  const [running, setRunning] = useState(false);
  const [autoOnToggle, setAutoOnToggle] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const runIdRef = useRef(0);

  const appendLog = useCallback((line: string) => {
    setLog((prev) => {
      const next = [...prev, line];
      return next.slice(-300);
    });
  }, []);

  const runAudit = useCallback(async () => {
    if (running) return;
    const myRun = ++runIdRef.current;
    setRunning(true);
    const mode = currentMode();
    appendLog(`[${nowIso()}] === Audit dimulai (mode: ${mode}) ===`);
    setRows((prev) => prev.map((r) => ({ ...r, status: "pending", ms: null, error: null, at: null, mode: null })));

    for (const entry of ROUTES) {
      if (runIdRef.current !== myRun) break;
      setRows((prev) => prev.map((r) => (r.to === entry.to ? { ...r, status: "running" } : r)));
      const t0 = performance.now();
      let status: Status = "ok";
      let errMsg: string | null = null;
      try {
        // TanStack Router preload: validates route match, beforeLoad, loader.
        // Tidak melakukan navigasi — aman dijalankan dari halaman ini.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (router as any).preloadRoute({ to: entry.to });
      } catch (e) {
        status = "fail";
        errMsg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
      const ms = Math.round(performance.now() - t0);
      const at = nowIso();
      setRows((prev) =>
        prev.map((r) => (r.to === entry.to ? { ...r, status, ms, error: errMsg, at, mode } : r)),
      );
      appendLog(
        status === "ok"
          ? `[${at}] OK    ${entry.to.padEnd(22)} ${ms}ms`
          : `[${at}] FAIL  ${entry.to.padEnd(22)} ${ms}ms — ${errMsg}`,
      );
    }

    appendLog(`[${nowIso()}] === Audit selesai (mode: ${mode}) ===`);
    setRunning(false);
  }, [appendLog, router, running]);

  // Auto-jalankan saat toggle Mode Ringkas/Normal.
  useEffect(() => {
    if (!autoOnToggle) return;
    const onChange = (e: Event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (e as CustomEvent).detail as { on?: boolean } | undefined;
      const mode: ModeLabel = detail?.on ? "ringkas" : "normal";
      appendLog(`[${nowIso()}] Mode beralih ke "${mode}" — menjalankan audit otomatis…`);
      void runAudit();
    };
    window.addEventListener(COMPACT_MODE_EVENT, onChange);
    return () => window.removeEventListener(COMPACT_MODE_EVENT, onChange);
  }, [autoOnToggle, runAudit, appendLog]);

  // Jalankan sekali saat halaman dibuka.
  useEffect(() => {
    void runAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const okCount = rows.filter((r) => r.status === "ok").length;
  const failCount = rows.filter((r) => r.status === "fail").length;

  function exportReport() {
    const mode = currentMode();
    const header = `MCM Storage — Laporan Audit Rute\nWaktu ekspor: ${nowIso()}\nMode saat ekspor: ${mode}\nOK: ${okCount} · Gagal: ${failCount} · Total: ${rows.length}\n\n`;
    const rowsTxt = rows
      .map((r) =>
        `${(r.status.toUpperCase()).padEnd(7)} ${r.to.padEnd(22)} ${(r.ms ?? "-")}ms  mode=${r.mode ?? "-"}  at=${r.at ?? "-"}` +
        (r.error ? `\n  └─ ${r.error}` : ""),
      )
      .join("\n");
    const logTxt = "\n\n--- Log ---\n" + log.join("\n");
    const blob = new Blob([header + rowsTxt + logTxt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-rute-${Date.now()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="mx-auto max-w-4xl px-3 py-4">
      <SecurityFindingsBanner compact />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link to="/" className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted">
          <ChevronLeft className="h-3.5 w-3.5" /> Beranda
        </Link>
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          <h1 className="text-base font-semibold">Audit Rute</h1>
        </div>
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          mode: {currentMode()}
        </span>
        <button
          onClick={() => void runAudit()}
          disabled={running}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {running ? "Sedang jalan…" : "Jalankan audit"}
        </button>
        <button
          onClick={exportReport}
          className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted"
          title="Unduh laporan .txt"
        >
          <Download className="h-3.5 w-3.5" /> Ekspor
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={autoOnToggle}
            onChange={(e) => setAutoOnToggle(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Audit otomatis saat Mode Ringkas/Normal diaktifkan
        </label>
        <StatusBadge size="xs" variant="siap">OK: {okCount}</StatusBadge>
        <StatusBadge size="xs" variant="danger">Gagal: {failCount}</StatusBadge>
        <StatusBadge size="xs" variant="selesai">Total: {rows.length}</StatusBadge>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Status</th>
              <th className="px-2 py-1.5 text-left font-medium">Rute</th>
              <th className="px-2 py-1.5 text-left font-medium">Durasi</th>
              <th className="px-2 py-1.5 text-left font-medium">Mode</th>
              <th className="px-2 py-1.5 text-left font-medium">Timestamp</th>
              <th className="px-2 py-1.5 text-left font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.to} className="border-t">
                <td className="px-2 py-1.5">
                  {r.status === "ok" && (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> OK
                    </span>
                  )}
                  {r.status === "fail" && (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <XCircle className="h-3.5 w-3.5" /> Gagal
                    </span>
                  )}
                  {r.status === "running" && (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> …
                    </span>
                  )}
                  {r.status === "pending" && <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-2 py-1.5 font-mono">{r.label} <span className="text-muted-foreground">({r.to})</span></td>
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.ms != null ? `${r.ms}ms` : "—"}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{r.mode ?? "—"}</td>
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.at ? new Date(r.at).toLocaleTimeString("id-ID") : "—"}</td>
                <td className="px-2 py-1.5 text-destructive">{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>Log waktu nyata</span>
          <button
            onClick={() => setLog([])}
            className="ml-auto inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[11px] hover:bg-muted"
          >
            <Trash2 className="h-3 w-3" /> Bersihkan
          </button>
        </div>
        <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/30 p-2 text-[11px] leading-relaxed">
{log.length ? log.join("\n") : "(belum ada log)"}
        </pre>
      </div>
    </div>
  );
}