const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse a comma-separated email list, validate each address, drop duplicates
 * (case-insensitive) including any already-seen addresses, and return both
 * the kept addresses (original casing preserved) and the invalid ones.
 */
export function parseEmailList(
  raw: string | null | undefined,
  seen: Set<string> = new Set(),
): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  if (!raw) return { valid, invalid };
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (!v) continue;
    if (!EMAIL_RE.test(v)) {
      invalid.push(v);
      continue;
    }
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(v);
  }
  return { valid, invalid };
}

export type MailtoInput = {
  to: string;
  cc?: string | null;
  bcc?: string | null;
};

export type MailtoResult = {
  href: string;
  cc: string[];
  bcc: string[];
  invalid: string[];
};

/**
 * Build a `mailto:` URL with validated, deduplicated CC and BCC lists.
 * Addresses that already appear in `to` (or earlier in CC) are skipped from
 * BCC, etc., so the same recipient is never sent twice.
 */
export function buildMailto({ to, cc, bcc }: MailtoInput): MailtoResult {
  const seen = new Set<string>();
  const toTrim = to.trim();
  if (EMAIL_RE.test(toTrim)) seen.add(toTrim.toLowerCase());

  const ccRes = parseEmailList(cc, seen);
  const bccRes = parseEmailList(bcc, seen);

  const params: string[] = [];
  if (ccRes.valid.length) params.push(`cc=${encodeURIComponent(ccRes.valid.join(","))}`);
  if (bccRes.valid.length) params.push(`bcc=${encodeURIComponent(bccRes.valid.join(","))}`);
  const qs = params.length ? `?${params.join("&")}` : "";

  return {
    href: `mailto:${encodeURIComponent(toTrim)}${qs}`,
    cc: ccRes.valid,
    bcc: bccRes.valid,
    invalid: [...ccRes.invalid, ...bccRes.invalid],
  };
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}