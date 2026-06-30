import React from "react";

// Match URLs (http/https/www) and bare domains like maps.google.com/...
const URL_RE =
  /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?'")\]}])|((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<]*)?)/gi;

function normalize(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `https://${href}`;
}

export function Linkify({ text }: { text: string }) {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    const match = m[0];
    const start = m.index;
    if (start > last) parts.push(text.slice(last, start));
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
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}