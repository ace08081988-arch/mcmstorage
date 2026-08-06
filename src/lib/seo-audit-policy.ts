/**
 * Kebijakan whitelist/blacklist untuk audit head/SEO.
 *
 * Kenapa perlu: sebagian halaman memang *sengaja* berbeda — pratinjau internal,
 * halaman kampanye dengan og:image khusus, rute dinamis yang jumlahnya ribuan,
 * atau URL yang cuma beda parameter tracking (`?utm_source=...`). Tanpa
 * kebijakan, audit akan gagal untuk hal yang bukan bug.
 *
 * Sumber kebenaran: `seo-audit.policy.json` di root (opsional). Bila tidak ada,
 * `DEFAULT_AUDIT_POLICY` dipakai. Modul ini murni tanpa I/O supaya bisa diuji.
 */

export type AuditExemption = {
  /** Pola path (glob: `*` satu segmen, `**` banyak segmen). */
  pattern: string;
  /** ID aturan yang dikecualikan, atau "*" untuk seluruh aturan. */
  rules: string[] | "*";
  /** Alasan wajib diisi agar pengecualian tidak jadi tempat sampah. */
  reason?: string;
};

export type AuditPolicy = {
  /** Whitelist: bila diisi, hanya path yang cocok yang diaudit. */
  include: string[];
  /** Blacklist: path yang cocok tidak pernah diaudit. */
  exclude: string[];
  /** Query param yang diabaikan saat membandingkan canonical/og:url. */
  ignoreParams: string[];
  /** Pengecualian aturan per-pola path. */
  exemptions: AuditExemption[];
};

export const DEFAULT_AUDIT_POLICY: AuditPolicy = {
  include: [],
  exclude: [
    "/lovable/**",
    "/api/**",
    "/not-found",
    "/auth/**",
    "/t/**", // link pegawai bertoken — sengaja noindex & unik per token
  ],
  ignoreParams: ["utm_*", "fbclid", "gclid", "ref", "src", "hl"],
  exemptions: [],
};

/** Lengkapi policy parsial (mis. dari JSON) dengan default. */
export function resolvePolicy(input?: Partial<AuditPolicy> | null): AuditPolicy {
  return {
    include: input?.include ?? DEFAULT_AUDIT_POLICY.include,
    exclude: input?.exclude ?? DEFAULT_AUDIT_POLICY.exclude,
    ignoreParams: input?.ignoreParams ?? DEFAULT_AUDIT_POLICY.ignoreParams,
    exemptions: input?.exemptions ?? DEFAULT_AUDIT_POLICY.exemptions,
  };
}

/** Glob sederhana: `*` = satu segmen, `**` = nol/lebih segmen, `?v=*` juga jalan. */
export function matchGlob(pattern: string, value: string): boolean {
  if (!pattern) return false;
  const rx = pattern
    .split("")
    .map((c) => {
      if (c === "*") return "\u0000";
      return /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
    })
    .join("")
    .replace(/\u0000\u0000/g, "\u0001")
    .replace(/\u0000/g, "[^/]*")
    .replace(/\u0001/g, ".*");
  return new RegExp(`^${rx}$`).test(value);
}

/** Ambil pathname dari URL absolut maupun path relatif. */
export function pathOf(url: string, base = "https://mcmstorage.app"): string {
  try {
    const u = new URL(url, base);
    return u.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url.split("?")[0].replace(/\/+$/, "") || "/";
  }
}

/** Apakah URL boleh diaudit menurut whitelist/blacklist? */
export function isUrlAudited(url: string, policy: AuditPolicy = DEFAULT_AUDIT_POLICY): boolean {
  const path = pathOf(url);
  if (policy.exclude.some((p) => matchGlob(p, path))) return false;
  if (policy.include.length && !policy.include.some((p) => matchGlob(p, path))) return false;
  return true;
}

export function filterAuditUrls(
  urls: string[],
  policy: AuditPolicy = DEFAULT_AUDIT_POLICY,
): { audited: string[]; skipped: string[] } {
  const audited: string[] = [];
  const skipped: string[] = [];
  for (const u of urls) (isUrlAudited(u, policy) ? audited : skipped).push(u);
  return { audited, skipped };
}

/** Apakah satu temuan dikecualikan untuk path tersebut? */
export function isIssueExempt(
  url: string,
  ruleId: string,
  policy: AuditPolicy = DEFAULT_AUDIT_POLICY,
): boolean {
  const path = pathOf(url);
  return policy.exemptions.some(
    (e) => matchGlob(e.pattern, path) && (e.rules === "*" || e.rules.includes(ruleId)),
  );
}

/** Buang query param dinamis yang tidak relevan bagi identitas halaman. */
export function stripIgnoredParams(
  url: string,
  policy: AuditPolicy = DEFAULT_AUDIT_POLICY,
  base = "https://mcmstorage.app",
): string {
  try {
    const u = new URL(url, base);
    for (const key of [...u.searchParams.keys()]) {
      if (policy.ignoreParams.some((p) => matchGlob(p, key))) u.searchParams.delete(key);
    }
    const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    u.search = "";
    for (const [k, v] of params) u.searchParams.append(k, v);
    return u.toString();
  } catch {
    return url;
  }
}

export function formatPolicy(policy: AuditPolicy): string {
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "—");
  return [
    `whitelist: ${list(policy.include)}`,
    `blacklist: ${list(policy.exclude)}`,
    `param diabaikan: ${list(policy.ignoreParams)}`,
    `pengecualian aturan: ${policy.exemptions.length}`,
  ].join(" | ");
}
