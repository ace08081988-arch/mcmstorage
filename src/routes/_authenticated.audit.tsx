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
      { name: "description", content: "Halaman audit internal: laporan otomatis status tiap menu/rute pada tampilan Ringkas & Normal. Tidak mengubah data atau environment." },
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
  // L5: pakai ref agar `runAudit` tidak perlu bergantung pada state
  // `running` (menghindari identitas fungsi berubah → efek/listener
  // ikut re-bind, dan stale closure saat auto-audit dipicu event).
  const runningRef = useRef(false);
  // Guard StrictMode double-mount: audit awal dijalankan sekali per sesi.
  const initialRanRef = useRef(false);

  const appendLog = useCallback((line: string) => {
    setLog((prev) => {
      const next = [...prev, line];
      return next.slice(-300);
    });
  }, []);

  const runAudit = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
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
    runningRef.current = false;
  }, [appendLog, router]);

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

  // Jalankan sekali saat halaman dibuka (guard StrictMode double-mount
  // dan stale closure — dep list eksplisit; ref `initialRanRef` memastikan
  // tidak looping).
  useEffect(() => {
    if (initialRanRef.current) return;
    initialRanRef.current = true;
    void runAudit();
  }, [runAudit]);

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
    <div className="mx-auto max-w-4xl px-ms-3 py-ms-4">
      <SecurityFindingsBanner compact />
      <div className="mb-3 flex flex-wrap items-center gap-ms-2">
        <Link to="/" className="inline-flex h-8 items-center gap-ms-1 rounded-md border px-ms-2 text-ms-xs text-muted-foreground hover:bg-muted">
          <ChevronLeft className="h-3.5 w-3.5" /> Beranda
        </Link>
        <div className="flex items-center gap-ms-2">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          <h1 className="text-ms-base font-semibold">Audit Rute</h1>
        </div>
        {/* L12: perjelas bahwa "mode" di sini merujuk ke tampilan
            Ringkas/Normal aplikasi — bukan environment (dev/prod) atau
            build mode. Prefiks "Tampilan:" dan label "Audit internal"
            memastikan operator tidak salah baca. */}
        <span
          className="ml-2 rounded bg-muted px-1.5 py-0.5 text-ms-2xs uppercase tracking-wide text-muted-foreground"
          title="Tampilan aplikasi saat audit dijalankan (Ringkas atau Normal)"
        >
          Tampilan: {currentMode() === "ringkas" ? "Ringkas" : "Normal"}
        </span>
        <span
          className="rounded border border-dashed border-muted-foreground/40 bg-background px-1.5 py-0.5 text-ms-2xs font-medium uppercase tracking-wide text-muted-foreground"
          title="Halaman internal untuk owner — tidak memengaruhi environment atau data aplikasi."
        >
          Audit internal
        </span>
        <button
          onClick={() => void runAudit()}
          disabled={running}
          className="ml-auto inline-flex h-8 items-center gap-ms-1 rounded-md bg-primary px-ms-3 text-ms-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {running ? "Sedang jalan…" : "Jalankan audit"}
        </button>
        <button
          onClick={exportReport}
          className="inline-flex h-8 items-center gap-ms-1 rounded-md border px-ms-2 text-ms-xs hover:bg-muted"
          title="Unduh laporan .txt"
        >
          <Download className="h-3.5 w-3.5" /> Ekspor
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-ms-3 text-ms-xs">
        <label className="inline-flex items-center gap-ms-1.5 text-muted-foreground">
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
        <table className="w-full text-ms-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-ms-2 py-1.5 text-left font-medium">Status</th>
              <th className="px-ms-2 py-1.5 text-left font-medium">Rute</th>
              <th className="px-ms-2 py-1.5 text-left font-medium">Durasi</th>
              <th className="px-ms-2 py-1.5 text-left font-medium">Tampilan</th>
              <th className="px-ms-2 py-1.5 text-left font-medium">Timestamp</th>
              <th className="px-ms-2 py-1.5 text-left font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.to} className="border-t">
                <td className="px-ms-2 py-1.5">
                  {r.status === "ok" && (
                    <span className="inline-flex items-center gap-ms-1 text-success dark:text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" /> OK
                    </span>
                  )}
                  {r.status === "fail" && (
                    <span className="inline-flex items-center gap-ms-1 text-destructive">
                      <XCircle className="h-3.5 w-3.5" /> Gagal
                    </span>
                  )}
                  {r.status === "running" && (
                    <span className="inline-flex items-center gap-ms-1 text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> …
                    </span>
                  )}
                  {r.status === "pending" && <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-ms-2 py-1.5 font-mono">{r.label} <span className="text-muted-foreground">({r.to})</span></td>
                <td className="px-ms-2 py-1.5 tabular-nums text-muted-foreground">{r.ms != null ? `${r.ms}ms` : "—"}</td>
                <td className="px-ms-2 py-1.5 text-muted-foreground">{r.mode ?? "—"}</td>
                <td className="px-ms-2 py-1.5 tabular-nums text-muted-foreground">{r.at ? new Date(r.at).toLocaleTimeString("id-ID") : "—"}</td>
                <td className="px-ms-2 py-1.5 text-destructive">{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center gap-ms-2 text-ms-xs text-muted-foreground">
          <span>Log waktu nyata</span>
          <button
            onClick={() => setLog([])}
            className="ml-auto inline-flex h-6 items-center gap-ms-1 rounded border px-1.5 text-ms-2xs hover:bg-muted"
          >
            <Trash2 className="h-3 w-3" /> Bersihkan
          </button>
        </div>
        <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/30 p-ms-2 text-ms-2xs leading-relaxed">
{log.length ? log.join("\n") : "(belum ada log)"}
        </pre>
      </div>
    </div>
  );
}