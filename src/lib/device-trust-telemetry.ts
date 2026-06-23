/**
 * Telemetri ringan untuk pemanggilan isDeviceTrusted.
 * - Console log terstruktur (mudah difilter via `tag:device-trust`).
 * - Buffer rolling di sessionStorage (maks 50 event terakhir) untuk
 *   inspeksi cepat saat user melaporkan blank screen.
 * - Counter agregat: total panggilan, total retry, total kegagalan, total
 *   status 500, p50/p95 durasi.
 */

export type AttemptEvent = {
  attempt: number;          // 1-based
  ok: boolean;
  status: number | null;    // HTTP status bila terdeteksi
  durationMs: number;
  errorMessage?: string;
  correlationId?: string;
};

export type CallEvent = {
  ts: string;               // ISO timestamp
  tag: "device-trust";
  outcome: "trusted" | "untrusted" | "failed";
  totalMs: number;
  attempts: AttemptEvent[];
  retries: number;          // attempts.length - 1
  cacheHit: boolean;
  correlationId?: string;
};

const LOG_KEY = "mcm_device_trust_log";
const METRICS_KEY = "mcm_device_trust_metrics";
const MAX_LOG = 50;

type Metrics = {
  calls: number;
  retries: number;
  failures: number;
  status500: number;
  durations: number[];      // capped to last 100 untuk menjaga ukuran
};

function readMetrics(): Metrics {
  try {
    const raw = sessionStorage.getItem(METRICS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { calls: 0, retries: 0, failures: 0, status500: 0, durations: [] };
}

function writeMetrics(m: Metrics) {
  try {
    sessionStorage.setItem(METRICS_KEY, JSON.stringify(m));
  } catch {}
}

function pushLog(event: CallEvent) {
  try {
    const raw = sessionStorage.getItem(LOG_KEY);
    const arr: CallEvent[] = raw ? JSON.parse(raw) : [];
    arr.push(event);
    while (arr.length > MAX_LOG) arr.shift();
    sessionStorage.setItem(LOG_KEY, JSON.stringify(arr));
  } catch {}
}

/** Coba ekstrak HTTP status dari error TanStack server-fn / fetch. */
export function extractStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as Record<string, unknown>;
  const candidates = [
    anyErr.status,
    (anyErr.response as { status?: unknown } | undefined)?.status,
    (anyErr.cause as { status?: unknown } | undefined)?.status,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  const msg = String((anyErr.message as string | undefined) ?? "");
  const m = msg.match(/\b(4\d{2}|5\d{2})\b/);
  return m ? Number(m[1]) : null;
}

export function recordDeviceTrustCall(event: CallEvent) {
  const m = readMetrics();
  m.calls += 1;
  m.retries += event.retries;
  if (event.outcome === "failed") m.failures += 1;
  for (const a of event.attempts) {
    if (a.status === 500) m.status500 += 1;
  }
  m.durations.push(event.totalMs);
  while (m.durations.length > 100) m.durations.shift();
  writeMetrics(m);
  pushLog(event);

  const logFn = event.outcome === "failed" ? console.error : event.retries > 0 ? console.warn : console.info;
  logFn("[device-trust]", {
    tag: "device-trust",
    outcome: event.outcome,
    totalMs: event.totalMs,
    retries: event.retries,
    attempts: event.attempts,
    cacheHit: event.cacheHit,
    ts: event.ts,
    correlationId: event.correlationId,
  });
}

/** Helper untuk inspeksi manual via DevTools console. */
export function getDeviceTrustDiagnostics() {
  const m = readMetrics();
  const sorted = [...m.durations].sort((a, b) => a - b);
  const pick = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
  let log: CallEvent[] = [];
  try {
    const raw = sessionStorage.getItem(LOG_KEY);
    if (raw) log = JSON.parse(raw);
  } catch {}
  return {
    metrics: {
      calls: m.calls,
      retries: m.retries,
      failures: m.failures,
      status500: m.status500,
      p50Ms: pick(0.5),
      p95Ms: pick(0.95),
    },
    recent: log,
  };
}

if (typeof window !== "undefined") {
  // Expose untuk debugging cepat: `__mcmDeviceTrust()` di console DevTools.
  (window as unknown as { __mcmDeviceTrust?: () => unknown }).__mcmDeviceTrust = getDeviceTrustDiagnostics;
}