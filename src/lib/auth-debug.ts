// Ringan: buffer log debug auth di localStorage (max 50 event) supaya bisa
// dilihat di halaman /auth-callback dan /diagnostics tanpa membocorkan token.

export type AuthDebugLevel = "info" | "warn" | "error";

export interface AuthDebugEvent {
  ts: string; // ISO timestamp
  scope: string; // e.g. "callback", "signup", "signin"
  level: AuthDebugLevel;
  msg: string;
  data?: Record<string, unknown>;
}

const KEY = "mcm:auth-debug-log";
const MAX = 50;

function redact(v: unknown): unknown {
  if (typeof v === "string") {
    if (v.length > 20 && /^[A-Za-z0-9._-]+$/.test(v)) {
      // JWT-like / token-like — potong.
      return `${v.slice(0, 6)}…${v.slice(-4)} (len=${v.length})`;
    }
    return v;
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/token|secret|password|key/i.test(k)) {
        out[k] = typeof val === "string" ? `«redacted» (len=${val.length})` : "«redacted»";
      } else {
        out[k] = redact(val);
      }
    }
    return out;
  }
  return v;
}

export function logAuthDebug(
  scope: string,
  msg: string,
  data?: Record<string, unknown>,
  level: AuthDebugLevel = "info",
): void {
  if (typeof window === "undefined") return;
  try {
    const entry: AuthDebugEvent = {
      ts: new Date().toISOString(),
      scope,
      level,
      msg,
      data: data ? (redact(data) as Record<string, unknown>) : undefined,
    };
    const raw = window.localStorage.getItem(KEY);
    const list: AuthDebugEvent[] = raw ? JSON.parse(raw) : [];
    list.push(entry);
    while (list.length > MAX) list.shift();
    window.localStorage.setItem(KEY, JSON.stringify(list));
    // Mirror ke console dengan prefix agar mudah dicari.
    // eslint-disable-next-line no-console
    const c = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    c(`[auth-debug:${scope}] ${msg}`, entry.data ?? "");
  } catch {
    // ignore — jangan sampai debugging bikin app crash.
  }
}

export function readAuthDebug(): AuthDebugEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthDebugEvent[]) : [];
  } catch {
    return [];
  }
}

export function clearAuthDebug(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

export function formatAuthDebug(events: AuthDebugEvent[]): string {
  return events
    .map((e) => `[${e.ts}] ${e.level.toUpperCase()} ${e.scope}: ${e.msg}${e.data ? " " + JSON.stringify(e.data) : ""}`)
    .join("\n");
}