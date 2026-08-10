import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const LOVABLE_IP = "185.158.133.1";
export const TXT_HOST_PREFIX = "_lovable";

export type DnsRecordType = "A" | "TXT" | "CNAME";
export type DnsCheckStatus = "ok" | "warn" | "fail";

export type DnsCheckResult = {
  key: "root-a" | "www-a" | "txt" | "google-txt" | "google-cname";
  type: DnsRecordType;
  host: string;
  found: string[];
  status: DnsCheckStatus;
  note?: string;
  resolver: string;
  checkedAt: string;
};

const DOH_ENDPOINTS = [
  { name: "cloudflare", url: "https://cloudflare-dns.com/dns-query" },
  { name: "google", url: "https://dns.google/resolve" },
] as const;

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/;

const inputSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => DOMAIN_RE.test(v), "Domain tidak valid"),
  googleCnameHost: z.string().trim().toLowerCase().optional(),
});

type DohAnswer = { data: string; type: number };
type DohResponse = { Answer?: DohAnswer[]; Status?: number };

async function queryDoh(name: string, type: DnsRecordType): Promise<{ values: string[]; resolver: string }> {
  const wantType = type === "A" ? 1 : type === "CNAME" ? 5 : 16;
  let lastError: unknown = null;
  for (const ep of DOH_ENDPOINTS) {
    try {
      const url = `${ep.url}?name=${encodeURIComponent(name)}&type=${type}`;
      const res = await fetch(url, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`DoH ${ep.name} ${res.status}`);
      const json = (await res.json()) as DohResponse;
      const values = (json.Answer ?? [])
        .filter((a) => a.type === wantType)
        .map((a) =>
          type === "TXT"
            ? a.data.replace(/^"|"$/g, "").replace(/"\s+"/g, "")
            : type === "CNAME"
              ? a.data.replace(/\.$/, "")
              : a.data,
        );
      return { values, resolver: ep.name };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("DoH failed");
}

export function classifyDnsResult(
  type: DnsRecordType,
  found: string[],
  opts?: { expect?: "lovable_verify" | "google-site-verification" | "google-hosted" },
): { status: DnsCheckStatus; note?: string } {
  const expect = opts?.expect ?? (type === "TXT" ? "lovable_verify" : undefined);
  if (type === "A") {
    if (found.includes(LOVABLE_IP)) {
      if (found.length === 1) return { status: "ok" };
      return { status: "warn", note: "Ada IP lain selain Lovable — hapus record ganda." };
    }
    return {
      status: "fail",
      note: `Tidak menemukan ${LOVABLE_IP}. Tambahkan/perbaiki record A di registrar.`,
    };
  }
  if (type === "CNAME") {
    if (found.some((v) => v.toLowerCase().endsWith("googlehosted.com"))) return { status: "ok" };
    if (found.length > 0)
      return { status: "warn", note: "CNAME ditemukan tapi bukan *.googlehosted.com." };
    return { status: "fail", note: "CNAME verifikasi Google belum ditemukan." };
  }
  if (expect === "google-site-verification") {
    if (found.some((v) => v.toLowerCase().startsWith("google-site-verification="))) return { status: "ok" };
    return {
      status: "fail",
      note: "Belum ada TXT google-site-verification=… di root domain.",
    };
  }
  if (found.some((v) => v.toLowerCase().startsWith("lovable_verify="))) return { status: "ok" };
  return {
    status: "fail",
    note: "Tidak menemukan TXT lovable_verify. Tambahkan record TXT dari Lovable.",
  };
}

export const checkDomainDns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { domain: string; googleCnameHost?: string }) => inputSchema.parse(input))
  .handler(async ({ data }): Promise<{ domain: string; checks: DnsCheckResult[] }> => {
    const domain = data.domain;
    const gHost = data.googleCnameHost?.trim();
    const targets: Array<{
      key: DnsCheckResult["key"];
      host: string;
      type: DnsRecordType;
      expect?: "lovable_verify" | "google-site-verification" | "google-hosted";
    }> = [
      { key: "root-a", host: domain, type: "A" },
      { key: "www-a", host: `www.${domain}`, type: "A" },
      { key: "txt", host: `${TXT_HOST_PREFIX}.${domain}`, type: "TXT" },
      { key: "google-txt", host: domain, type: "TXT", expect: "google-site-verification" },
    ];
    if (gHost) {
      targets.push({
        key: "google-cname",
        host: gHost.endsWith(domain) ? gHost : `${gHost}.${domain}`,
        type: "CNAME",
        expect: "google-hosted",
      });
    }
    const checkedAt = new Date().toISOString();
    const checks = await Promise.all(
      targets.map(async (t): Promise<DnsCheckResult> => {
        try {
          const { values, resolver } = await queryDoh(t.host, t.type);
          const { status, note } = classifyDnsResult(t.type, values, { expect: t.expect });
          return { key: t.key, type: t.type, host: t.host, found: values, status, note, resolver, checkedAt };
        } catch (err) {
          return {
            key: t.key,
            type: t.type,
            host: t.host,
            found: [],
            status: "fail",
            note: err instanceof Error ? `Gagal query DNS: ${err.message}` : "Gagal query DNS",
            resolver: "-",
            checkedAt,
          };
        }
      }),
    );
    return { domain, checks };
  });