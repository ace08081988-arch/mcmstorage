import React from "react";

// Match URLs (http/https/www) and bare domains like maps.google.com/...
const URL_RE =
  /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?'")\]}])|((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]*)?)/gi;

function normalize(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `https://${href}`;
}

/** Bungkus setiap kemunculan `needle` (case-insensitive) dengan <mark>. */
function markTerm(text: string, needle: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const hay = text.toLowerCase();
  const n = needle.toLowerCase();
  let from = 0;
  let idx = hay.indexOf(n, from);
  let i = 0;
  while (idx !== -1) {
    if (idx > from) out.push(text.slice(from, idx));
    out.push(
      <mark
        key={`${keyBase}-mk-${i++}`}
        className="rounded-[3px] bg-warning/70 px-0.5 text-foreground"
      >
        {text.slice(idx, idx + n.length)}
      </mark>,
    );
    from = idx + n.length;
    idx = hay.indexOf(n, from);
  }
  if (from < text.length) out.push(text.slice(from));
  return out;
}

export function Linkify({ text, highlight }: { text: string; highlight?: string }) {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    const match = m[0];
    const start = m.index;
    if (start > last) parts.push(...withHl(text.slice(last, start), highlight, `p${last}`));
    const href = normalize(match);
    parts.push(
      <a
        key={`${start}-${match}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all hover:opacity-80"
        onClick={(e) => e.stopPropagation()}
      >
        {match}
      </a>,
    );
    last = start + match.length;
  }
  if (last < text.length) parts.push(...withHl(text.slice(last), highlight, `p${last}`));
  return <>{parts}</>;
}

function withHl(chunk: string, highlight: string | undefined, keyBase: string): React.ReactNode[] {
  const needle = highlight?.trim();
  if (!needle) return [chunk];
  return markTerm(chunk, needle, keyBase);
}

// ---------------- URL Preview chips ----------------

export type DetectedUrl = { raw: string; href: string; host: string; path: string };

export function extractUrls(text: string): DetectedUrl[] {
  if (!text) return [];
  const out: DetectedUrl[] = [];
  const seen = new Set<string>();
  const re = new RegExp(URL_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const href = normalize(raw);
    if (seen.has(href)) continue;
    seen.add(href);
    let host = "";
    let path = "";
    try {
      const u = new URL(href);
      host = u.hostname.replace(/^www\./, "");
      path = (u.pathname === "/" ? "" : u.pathname) + (u.search || "");
    } catch {
      host = raw;
    }
    out.push({ raw, href, host, path });
    if (out.length >= 4) break;
  }
  return out;
}

function labelFor(host: string): { kind: string; emoji: string } {
  const h = host.toLowerCase();
  if (/(^|\.)google\.[^/]+$/.test(h) && /maps/.test(h)) return { kind: "Google Maps", emoji: "📍" };
  if (h === "maps.app.goo.gl" || h === "goo.gl" || h.endsWith("g.co"))
    return { kind: "Google Maps", emoji: "📍" };
  if (h.endsWith("google.com") || h.endsWith("google.co.id"))
    return { kind: "Google", emoji: "🔎" };
  if (h === "wa.me" || h.endsWith("whatsapp.com")) return { kind: "WhatsApp", emoji: "💬" };
  if (h.endsWith("youtube.com") || h === "youtu.be") return { kind: "YouTube", emoji: "▶️" };
  if (h.endsWith("instagram.com")) return { kind: "Instagram", emoji: "📷" };
  if (h.endsWith("facebook.com") || h === "fb.com") return { kind: "Facebook", emoji: "📘" };
  if (h.endsWith("tiktok.com")) return { kind: "TikTok", emoji: "🎵" };
  if (h.endsWith("twitter.com") || h === "x.com") return { kind: "X / Twitter", emoji: "🐦" };
  if (h.endsWith("shopee.co.id") || h.endsWith("shopee.com"))
    return { kind: "Shopee", emoji: "🛒" };
  if (h.endsWith("tokopedia.com")) return { kind: "Tokopedia", emoji: "🛍️" };
  if (h.endsWith("mcmstorage.biz") || h.endsWith("mcmstorage.lovable.app"))
    return { kind: "MCM Storage", emoji: "📦" };
  return { kind: "Tautan", emoji: "🔗" };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function UrlPreviewList({ text, mine = false }: { text: string; mine?: boolean }) {
  const urls = extractUrls(text);
  if (urls.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-ms-1">
      {urls.map((u) => {
        const { kind, emoji } = labelFor(u.host);
        return (
          <a
            key={u.href}
            href={u.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={
              "flex items-center gap-ms-2 rounded-md border px-ms-2 py-1.5 text-ms-2xs leading-tight no-underline hover:opacity-90 " +
              (mine
                ? "border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground"
                : "border-border bg-background/70 text-foreground")
            }
            title={u.href}
          >
            <span aria-hidden className="text-ms-base leading-none">
              {emoji}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{kind}</span>
              <span className="block truncate opacity-80">
                {u.host}
                {u.path ? truncate(u.path, 48) : ""}
              </span>
            </span>
            <span className="shrink-0 text-ms-2xs opacity-70">Buka ↗</span>
          </a>
        );
      })}
    </div>
  );
}
