import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle, ChevronLeft, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import reactRouterPkg from "@tanstack/react-router/package.json";
import reactStartPkg from "@tanstack/react-start/package.json";
import routerCorePkg from "@tanstack/router-core/package.json";
import routerPluginPkg from "@tanstack/router-plugin/package.json";
import reactQueryPkg from "@tanstack/react-query/package.json";

export const Route = createFileRoute("/_authenticated/diagnostics")({
  head: () => ({ meta: [{ title: "Diagnostik · MCM Storage" }] }),
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

  async function copySummary() {
    const lines: string[] = [];
    lines.push(`Diagnostik MCM Storage — ${new Date().toISOString()}`);
    lines.push(`Status: ${allOk ? "KOMPATIBEL ✓" : "ADA KETIDAKCOCOKAN ⚠"}`);
    lines.push("");
    lines.push("Versi paket:");
    for (const p of packages) lines.push(`  - ${p.name}@${p.version}`);
    lines.push("");
    lines.push("Hasil cek:");
    for (const c of checks) lines.push(`  [${c.ok ? "OK" : "FAIL"}] ${c.label} — ${c.detail}`);
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Ringkasan diagnostik disalin");
    } catch {
      toast.error("Gagal menyalin", { description: "Salin manual dari kotak di bawah." });
      // Fallback: show in a prompt-like toast
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