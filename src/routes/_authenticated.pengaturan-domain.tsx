import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Copy, RefreshCw, Globe as GlobeIcon } from "lucide-react";
import { toast } from "sonner";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { checkDomainDns, LOVABLE_IP, TXT_HOST_PREFIX, type DnsCheckResult } from "@/lib/domain-dns.functions";

export const Route = createFileRoute("/_authenticated/pengaturan-domain")({
  head: () => ({
    meta: [
      { title: "Pengaturan Domain · MCM Storage" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DomainSettingsPage,
});

type CheckStatus = "idle" | "checking" | DnsCheckResult["status"];

type Row = {
  key: DnsCheckResult["key"];
  label: string;
  type: DnsCheckResult["type"];
  host: string;
  expectedHint: string;
  status: CheckStatus;
  found: string[];
  note?: string;
  resolver?: string;
  checkedAt?: string;
};

function initialRows(domain: string): Row[] {
  const d = domain || "domain";
  return [
    { key: "root-a", label: `A · ${d} (@)`, type: "A", host: domain, expectedHint: LOVABLE_IP, status: "idle", found: [] },
    { key: "www-a", label: `A · www.${d}`, type: "A", host: `www.${domain}`, expectedHint: LOVABLE_IP, status: "idle", found: [] },
    { key: "txt", label: `TXT · ${TXT_HOST_PREFIX}.${d}`, type: "TXT", host: `${TXT_HOST_PREFIX}.${domain}`, expectedHint: "lovable_verify=…", status: "idle", found: [] },
    { key: "google-txt", label: `TXT · ${d} (Google Workspace)`, type: "TXT", host: domain, expectedHint: "google-site-verification=…", status: "idle", found: [] },
  ];
}

const STATUS_STYLES: Record<CheckStatus, { badge: string; label: string; icon: ReactNode }> = {
  idle: {
    badge: "bg-muted text-muted-foreground",
    label: "Belum dicek",
    icon: <RefreshCw className="h-4 w-4" />,
  },
  checking: {
    badge: "bg-muted text-muted-foreground",
    label: "Memeriksa…",
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
  },
  ok: {
    badge: "bg-success/15 text-success dark:text-success",
    label: "OK",
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  warn: {
    badge: "bg-warning/15 text-warning dark:text-warning",
    label: "Perlu review",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  fail: {
    badge: "bg-red-500/15 text-red-600 dark:text-red-400",
    label: "Belum sesuai",
    icon: <XCircle className="h-4 w-4" />,
  },
};

function DomainSettingsPage() {
  const [domain, setDomain] = useState("mcmstorage.biz");
  const [gCname, setGCname] = useState("");
  const rows = useMemo<Row[]>(() => {
    const base = initialRows(domain.trim());
    const h = gCname.trim();
    if (h) {
      const host = h.endsWith(domain.trim()) ? h : `${h}.${domain.trim()}`;
      base.push({
        key: "google-cname",
        label: `CNAME · ${host}`,
        type: "CNAME",
        host,
        expectedHint: "…dv.googlehosted.com",
        status: "idle",
        found: [],
      });
    }
    return base;
  }, [domain, gCname]);
  const [state, setState] = useState<Record<Row["key"], Row>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, r])) as Record<Row["key"], Row>,
  );
  const invokeCheck = useServerFn(checkDomainDns);
  const [busy, setBusy] = useState(false);

  // Reset display state when domain changes
  useMemo(() => {
    setState(Object.fromEntries(rows.map((r) => [r.key, r])) as Record<Row["key"], Row>);
  }, [rows]);

  const checks = rows.map((r) => state[r.key] ?? r);

  const runAll = useCallback(async () => {
    const d = domain.trim();
    if (!d) {
      toast.error("Isi nama domain dulu.");
      return;
    }
    setBusy(true);
    setState((prev) => {
      const next = { ...prev };
      for (const r of rows) next[r.key] = { ...(prev[r.key] ?? r), status: "checking", note: undefined };
      return next;
    });
    try {
      const result = await invokeCheck({ data: { domain: d, googleCnameHost: gCname.trim() || undefined } });
      setState((prev) => {
        const next = { ...prev };
        for (const c of result.checks) {
          const base = prev[c.key] ?? rows.find((r) => r.key === c.key)!;
          next[c.key] = {
            ...base,
            status: c.status,
            found: c.found,
            note: c.note,
            resolver: c.resolver,
            checkedAt: c.checkedAt,
          };
        }
        return next;
      });
      const okCount = result.checks.filter((c) => c.status === "ok").length;
      if (okCount === result.checks.length) toast.success("Semua record OK.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Validasi DNS gagal";
      toast.error(msg);
      setState((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          const base = prev[r.key] ?? r;
          if (base.status === "checking") next[r.key] = { ...base, status: "fail", note: msg };
        }
        return next;
      });
    } finally {
      setBusy(false);
    }
  }, [domain, gCname, invokeCheck, rows]);

  const summary = useMemo(() => {
    const oks = checks.filter((c) => c.status === "ok").length;
    return `${oks}/${checks.length} record OK`;
  }, [checks]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Disalin.");
    } catch {
      toast.error("Gagal menyalin.");
    }
  };

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-10">
      <SettingsHeader title="Pengaturan Domain" subtitle="Checklist DNS untuk custom domain" icon={GlobeIcon} />
      <div className="space-ms-4 px-ms-4 pt-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-ms-base">Domain</CardTitle>
            <CardDescription className="text-ms-xs">
              Masukkan domain apex (tanpa https:// dan tanpa www). Kami periksa 3 record via DNS-over-HTTPS Cloudflare.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-ms-3">
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
              placeholder="mcmstorage.biz"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
            />
            <Input
              value={gCname}
              onChange={(e) => setGCname(e.target.value.trim().toLowerCase())}
              placeholder="CNAME Google (opsional), mis. x43lgnaxqio2"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="flex items-center justify-between gap-ms-2">
              <span className="text-ms-xs text-muted-foreground">{summary}</span>
              <Button size="sm" onClick={runAll} disabled={!domain.trim() || busy}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                Periksa semua
              </Button>
            </div>
          </CardContent>
        </Card>

        {checks.map((c) => {
          const s = STATUS_STYLES[c.status];
          return (
            <Card key={c.key}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-ms-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-ms-sm">{c.label}</CardTitle>
                    <CardDescription className="text-ms-xs">
                      Tipe {c.type} · nilai target <span className="font-mono">{c.expectedHint}</span>
                    </CardDescription>
                  </div>
                  <Badge className={`shrink-0 gap-ms-1 ${s.badge}`} variant="secondary">
                    {s.icon}
                    {s.label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-ms-3">
                <div className="flex items-center gap-ms-2">
                  <code className="flex-1 truncate rounded border bg-muted/50 px-ms-2 py-1 font-mono text-ms-xs">
                    {c.host || "—"}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => copy(c.host)}
                    aria-label="Salin host"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {c.found.length > 0 ? (
                  <ul className="space-y-1 text-ms-xs">
                    {c.found.map((v, i) => (
                      <li key={`${c.key}-${i}`} className="flex items-center gap-ms-2 font-mono">
                        {c.type === "A" && v === LOVABLE_IP ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        ) : c.type === "TXT" &&
                          (v.toLowerCase().startsWith("lovable_verify=") ||
                            (c.key === "google-txt" && v.toLowerCase().startsWith("google-site-verification="))) ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        ) : c.type === "CNAME" && v.toLowerCase().endsWith("googlehosted.com") ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                        )}
                        <span className="truncate">{v}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {c.note ? <p className="text-ms-xs text-muted-foreground">{c.note}</p> : null}
                {c.resolver && c.checkedAt ? (
                  <p className="text-ms-2xs text-muted-foreground">
                    Resolver: {c.resolver} · {new Date(c.checkedAt).toLocaleTimeString()}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-ms-sm">Petunjuk singkat</CardTitle>
          </CardHeader>
          <CardContent className="space-ms-2 text-ms-xs text-muted-foreground">
            <p>1. Di registrar (mis. name.com), tambahkan record berikut:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li><span className="font-mono">A @ → {LOVABLE_IP}</span></li>
              <li><span className="font-mono">A www → {LOVABLE_IP}</span></li>
              <li><span className="font-mono">TXT {TXT_HOST_PREFIX} → lovable_verify=… (dari Lovable)</span></li>
            </ul>
            <p>2. Tunggu propagasi (biasanya menit, maksimal 72 jam) lalu tekan “Periksa semua”.</p>
            <p>3. Warna hijau = OK, kuning = ada record ganda yang perlu dihapus, merah = belum ditemukan.</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}