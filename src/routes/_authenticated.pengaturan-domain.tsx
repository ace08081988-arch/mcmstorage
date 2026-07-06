import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SettingsHeader } from "@/components/settings/SettingsHeader";

export const Route = createFileRoute("/_authenticated/pengaturan-domain")({
  head: () => ({
    meta: [
      { title: "Pengaturan Domain · MCM Storage" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DomainSettingsPage,
});

const LOVABLE_IP = "185.158.133.1";
const TXT_HOST_PREFIX = "_lovable";

type CheckStatus = "idle" | "checking" | "ok" | "warn" | "fail";

type RecordCheck = {
  key: "root-a" | "www-a" | "txt";
  label: string;
  type: "A" | "TXT";
  host: string;
  expectedHint: string;
  status: CheckStatus;
  found: string[];
  note?: string;
};

function initialChecks(domain: string): RecordCheck[] {
  return [
    {
      key: "root-a",
      label: `A · ${domain || "domain"} (@)`,
      type: "A",
      host: domain,
      expectedHint: LOVABLE_IP,
      status: "idle",
      found: [],
    },
    {
      key: "www-a",
      label: `A · www.${domain || "domain"}`,
      type: "A",
      host: `www.${domain}`,
      expectedHint: LOVABLE_IP,
      status: "idle",
      found: [],
    },
    {
      key: "txt",
      label: `TXT · ${TXT_HOST_PREFIX}.${domain || "domain"}`,
      type: "TXT",
      host: `${TXT_HOST_PREFIX}.${domain}`,
      expectedHint: "lovable_verify=…",
      status: "idle",
      found: [],
    },
  ];
}

async function queryDns(name: string, type: "A" | "TXT"): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetch(url, { headers: { accept: "application/dns-json" } });
  if (!res.ok) throw new Error(`DNS ${res.status}`);
  const json = (await res.json()) as { Answer?: Array<{ data: string; type: number }> };
  const wantType = type === "A" ? 1 : 16;
  return (json.Answer ?? [])
    .filter((a) => a.type === wantType)
    .map((a) => (type === "TXT" ? a.data.replace(/^"|"$/g, "") : a.data));
}

function statusFor(check: RecordCheck): CheckStatus {
  if (check.status === "checking" || check.status === "idle") return check.status;
  if (check.type === "A") {
    if (check.found.includes(LOVABLE_IP)) {
      return check.found.length === 1 ? "ok" : "warn";
    }
    return "fail";
  }
  // TXT
  if (check.found.some((v) => v.toLowerCase().startsWith("lovable_verify="))) return "ok";
  return "fail";
}

const STATUS_STYLES: Record<CheckStatus, { badge: string; label: string; icon: JSX.Element }> = {
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
    badge: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    label: "OK",
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  warn: {
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
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
  const [checks, setChecks] = useState<RecordCheck[]>(() => initialChecks("mcmstorage.biz"));

  useEffect(() => {
    setChecks(initialChecks(domain.trim()));
  }, [domain]);

  const runCheck = useCallback(async (key: RecordCheck["key"]) => {
    setChecks((prev) => prev.map((c) => (c.key === key ? { ...c, status: "checking", note: undefined } : c)));
    const target = checks.find((c) => c.key === key);
    if (!target || !target.host || target.host.startsWith(".")) return;
    try {
      const found = await queryDns(target.host, target.type);
      setChecks((prev) =>
        prev.map((c) => {
          if (c.key !== key) return c;
          const next: RecordCheck = { ...c, found, status: "ok" };
          next.status = statusFor(next);
          if (next.status === "warn" && c.type === "A") {
            next.note = "Ditemukan IP lain selain Lovable — hapus record ganda.";
          } else if (next.status === "fail") {
            next.note =
              c.type === "A"
                ? `Tidak menemukan ${LOVABLE_IP}. Tambahkan/perbaiki record A.`
                : "Tidak menemukan TXT lovable_verify. Tambahkan record TXT dari Lovable.";
          }
          return next;
        }),
      );
    } catch (err) {
      setChecks((prev) =>
        prev.map((c) =>
          c.key === key
            ? { ...c, status: "fail", found: [], note: err instanceof Error ? err.message : "Gagal query DNS" }
            : c,
        ),
      );
    }
  }, [checks]);

  const runAll = useCallback(async () => {
    if (!domain.trim()) {
      toast.error("Isi nama domain dulu.");
      return;
    }
    await Promise.all((["root-a", "www-a", "txt"] as const).map((k) => runCheck(k)));
  }, [domain, runCheck]);

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
      <SettingsHeader title="Pengaturan Domain" subtitle="Checklist DNS untuk custom domain" />
      <div className="space-y-4 px-4 pt-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Domain</CardTitle>
            <CardDescription className="text-xs">
              Masukkan domain apex (tanpa https:// dan tanpa www). Kami periksa 3 record via DNS-over-HTTPS Cloudflare.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
              placeholder="mcmstorage.biz"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{summary}</span>
              <Button size="sm" onClick={runAll} disabled={!domain.trim()}>
                <RefreshCw className="mr-1 h-4 w-4" /> Periksa semua
              </Button>
            </div>
          </CardContent>
        </Card>

        {checks.map((c) => {
          const s = STATUS_STYLES[c.status];
          return (
            <Card key={c.key}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-sm">{c.label}</CardTitle>
                    <CardDescription className="text-xs">
                      Tipe {c.type} · nilai target <span className="font-mono">{c.expectedHint}</span>
                    </CardDescription>
                  </div>
                  <Badge className={`shrink-0 gap-1 ${s.badge}`} variant="secondary">
                    {s.icon}
                    {s.label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded border bg-muted/50 px-2 py-1 font-mono text-xs">
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
                  <ul className="space-y-1 text-xs">
                    {c.found.map((v, i) => (
                      <li key={`${c.key}-${i}`} className="flex items-center gap-2 font-mono">
                        {c.type === "A" && v === LOVABLE_IP ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        ) : c.type === "TXT" && v.toLowerCase().startsWith("lovable_verify=") ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                        )}
                        <span className="truncate">{v}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {c.note ? <p className="text-xs text-muted-foreground">{c.note}</p> : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => runCheck(c.key)}
                  disabled={!c.host || c.status === "checking"}
                >
                  {c.status === "checking" ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-4 w-4" />
                  )}
                  Periksa record ini
                </Button>
              </CardContent>
            </Card>
          );
        })}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Petunjuk singkat</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
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