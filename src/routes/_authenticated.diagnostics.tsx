import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, ChevronLeft, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { buildDiagnosticsSummary } from "@/lib/diagnostics-summary";
import { useEffect, useState, useCallback } from "react";
import { copyText } from "@/lib/share-wa";

import reactRouterPkg from "@tanstack/react-router/package.json";
import reactStartPkg from "@tanstack/react-start/package.json";
import routerCorePkg from "@tanstack/router-core/package.json";
import routerPluginPkg from "@tanstack/router-plugin/package.json";
import reactQueryPkg from "@tanstack/react-query/package.json";

export const Route = createFileRoute("/_authenticated/diagnostics")({
  head: () => ({
    meta: [
      { title: "Diagnostik · MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DiagnosticsPage,
});

type Pkg = { name: string; version: string; dependencies?: Record<string, string> };

function minor(v: string): string {
  const m = v.match(/^(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : v;
}

function stripRange(spec: string): string {
  return spec.replace(/^[\^~>=<\s]+/, "").trim();
}

type Check = { label: string; ok: boolean; detail: string };

async function runBrowserChecks(): Promise<Check[]> {
  const out: Check[] = [];
  if (typeof window === "undefined") return out;

  const isSecure = window.isSecureContext;
  out.push({
    label: "Secure context (HTTPS)",
    ok: isSecure,
    detail: isSecure
      ? "Halaman dimuat lewat HTTPS — clipboard & share API tersedia."
      : "Bukan HTTPS. Banyak browser memblokir clipboard & Web Share di konteks tidak aman.",
  });

  const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
  out.push({
    label: "Konteks iframe",
    ok: !inIframe,
    detail: inIframe
      ? "Berjalan di dalam iframe (mis. pratinjau Lovable). Browser bisa memblokir popup, clipboard, atau Web Share tanpa atribut allow."
      : "Top-level — tidak ada batasan iframe.",
  });

  const hasShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  out.push({
    label: "Web Share API (navigator.share)",
    ok: hasShare,
    detail: hasShare
      ? "Tersedia — tombol Bagikan dapat memunculkan share sheet sistem."
      : "Tidak tersedia. Tombol Bagikan akan fallback ke 'Buka WA Web'.",
  });

  const hasCanShare = typeof navigator !== "undefined" && typeof navigator.canShare === "function";
  let canShareFiles = false;
  if (hasCanShare) {
    try {
      const f = new File(["x"], "test.txt", { type: "text/plain" });
      canShareFiles = navigator.canShare({ files: [f] });
    } catch { canShareFiles = false; }
  }
  out.push({
    label: "Web Share dengan lampiran file",
    ok: canShareFiles,
    detail: canShareFiles
      ? "Browser mengizinkan share file — foto bisa ikut terkirim."
      : "Browser tidak mengizinkan share file. Foto perlu dilampirkan manual di MCM.",
  });

  const hasClipboard = typeof navigator !== "undefined" && !!navigator.clipboard?.writeText;
  out.push({
    label: "Clipboard API (navigator.clipboard)",
    ok: hasClipboard,
    detail: hasClipboard
      ? "Tersedia — salin otomatis didukung."
      : "Tidak tersedia. Akan fallback ke document.execCommand atau salin manual.",
  });

  let permState = "tak diketahui";
  let permOk = true;
  try {
    const p = navigator.permissions as Permissions | undefined;
    if (p && typeof p.query === "function") {
      const r = await p.query({ name: "clipboard-write" as PermissionName });
      permState = r.state;
      permOk = r.state !== "denied";
    }
  } catch {
    permState = "tidak didukung";
  }
  out.push({
    label: "Izin clipboard-write",
    ok: permOk,
    detail: `Status: ${permState}.` + (permState === "denied" ? " Pengguna perlu mengizinkan clipboard di pengaturan situs." : ""),
  });

  const hasExec = typeof document !== "undefined" && typeof document.execCommand === "function";
  out.push({
    label: "Fallback execCommand('copy')",
    ok: hasExec,
    detail: hasExec ? "Tersedia sebagai fallback bila Clipboard API gagal." : "Tidak tersedia — tidak ada fallback salin.",
  });

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  out.push({
    label: "User agent",
    ok: true,
    detail: ua || "(tidak tersedia)",
  });

  return out;
}

function runChecks(): Check[] {
  const out: Check[] = [];
  const start = reactStartPkg as Pkg;
  const router = reactRouterPkg as Pkg;
  const core = routerCorePkg as Pkg;

  const expectedRouter = stripRange(start.dependencies?.["@tanstack/react-router"] ?? "");
  if (expectedRouter) {
    const ok = expectedRouter === router.version;
    out.push({
      label: "@tanstack/react-start ↔ @tanstack/react-router",
      ok,
      detail: ok
        ? `react-start mengharapkan react-router ${expectedRouter} → terpasang ${router.version}.`
        : `react-start mengharapkan react-router ${expectedRouter}, tetapi terpasang ${router.version}. Ini dapat memicu TypeError saat preload route.`,
    });
  }

  const expectedCore = stripRange(router.dependencies?.["@tanstack/router-core"] ?? "");
  if (expectedCore) {
    const ok = minor(expectedCore) === minor(core.version);
    out.push({
      label: "@tanstack/react-router ↔ @tanstack/router-core",
      ok,
      detail: ok
        ? `react-router butuh router-core ${minor(expectedCore)}.x → terpasang ${core.version}.`
        : `react-router butuh router-core ${expectedCore}, tetapi terpasang ${core.version}.`,
    });
  }

  out.push({
    label: "Minor version react-router & react-start",
    ok: minor(router.version).split(".")[0] === minor(start.version).split(".")[0],
    detail: `react-router ${router.version} · react-start ${start.version}`,
  });

  return out;
}

function DiagnosticsPage() {
  const packages: Pkg[] = [
    reactRouterPkg as Pkg,
    reactStartPkg as Pkg,
    routerCorePkg as Pkg,
    routerPluginPkg as Pkg,
    reactQueryPkg as Pkg,
  ];
  const checks = runChecks();
  const allOk = checks.every((c) => c.ok);

  const [browserChecks, setBrowserChecks] = useState<Check[]>([]);
  const refreshBrowser = useCallback(() => {
    void runBrowserChecks().then(setBrowserChecks);
  }, []);
  useEffect(() => { refreshBrowser(); }, [refreshBrowser]);

  async function testCopy() {
    const res = await copyText("MCM Storage clipboard test " + new Date().toISOString());
    if (res.ok) toast.success("Tes salin berhasil — clipboard berfungsi.");
    else if (res.reason === "denied") toast.error("Izin clipboard ditolak browser.");
    else toast.error("Browser tak mendukung salin otomatis.");
    refreshBrowser();
  }
  async function testShare() {
    if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
      toast.error("Web Share API tidak tersedia di browser ini.");
      return;
    }
    try {
      await navigator.share({ title: "MCM Storage", text: "Tes Web Share", url: window.location.origin });
      toast.success("Web Share API berfungsi.");
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === "AbortError") toast.message("Tes share dibatalkan.");
      else toast.error(`Web Share gagal: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  function buildSummary(): string {
    return buildDiagnosticsSummary({
      appName: "MCM Storage",
      timestamp: new Date(),
      packages: packages.map((p) => ({ name: p.name, version: p.version })),
      checks: [...checks, ...browserChecks].map((c) => ({ label: c.label, ok: c.ok, detail: c.detail })),
    });
  }

  async function copySummary() {
    const text = buildSummary();
    const res = await copyText(text);
    if (res.ok) {
      toast.success("Ringkasan diagnostik disalin");
    } else {
      toast.error("Gagal menyalin", { description: "Salin manual dari kotak di bawah." });
      toast.message(text);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-3 sm:p-5">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/"><ChevronLeft className="h-4 w-4" /> Kembali</Link>
        </Button>
        <h1 className="text-lg font-semibold">Diagnostik Aplikasi</h1>
        <Button size="sm" variant="outline" className="ml-auto" onClick={copySummary}>
          <Copy className="h-4 w-4" /> Salin ringkasan
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span>Dukungan browser (share & clipboard)</span>
            <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={refreshBrowser} title="Periksa ulang">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {browserChecks.length === 0 ? (
            <div className="text-xs text-muted-foreground">Memeriksa…</div>
          ) : browserChecks.map((c) => (
            <div key={c.label} className="flex items-start gap-2 rounded-md border bg-card/50 p-2">
              {c.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              )}
              <div className="min-w-0 flex-1 text-xs">
                <div className="font-medium">{c.label}</div>
                <div className={c.ok ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}>{c.detail}</div>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => void testCopy()}>Tes Salin</Button>
            <Button size="sm" variant="outline" onClick={() => void testShare()}>Tes Bagikan</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Hasil dimasukkan ke "Salin ringkasan" agar mudah dikirim saat melapor.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {allOk ? (
              <><CheckCircle2 className="h-5 w-5 text-emerald-600" /> Versi paket router kompatibel</>
            ) : (
              <><AlertTriangle className="h-5 w-5 text-destructive" /> Terdeteksi ketidakcocokan versi</>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-2 rounded-md border bg-card/50 p-2">
              {c.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1 text-xs">
                <div className="font-medium">{c.label}</div>
                <div className={c.ok ? "text-muted-foreground" : "text-destructive"}>{c.detail}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Versi paket TanStack</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr><th className="py-1 text-left font-medium">Paket</th><th className="py-1 text-left font-medium">Versi</th></tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={p.name} className="border-t">
                  <td className="py-1.5 font-mono">{p.name}</td>
                  <td className="py-1.5 font-mono">{p.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Versi dibaca langsung dari <code>package.json</code> tiap paket saat build, jadi mencerminkan
            apa yang benar-benar dijalankan aplikasi.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}