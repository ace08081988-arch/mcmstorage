/**
 * Lightweight performance logger untuk landing/dashboard.
 *
 * Tujuan: mendeteksi regresi loading (mis. bagian "Lainnya" tiba-tiba
 * lambat mount setelah refactor) tanpa menambah dependency berat.
 *
 * - `perfMark(name)` — panggil di titik penting (mis. saat hero siap,
 *   saat chunk mulai/selesai mount).
 * - `perfMeasure(name, from, to?)` — hitung durasi antara dua mark,
 *   log ke `console.info` (tag `[perf]`) dan (opsional) kirim ke
 *   endpoint beacon `VITE_PERF_BEACON_URL` supaya bisa dikumpulkan
 *   di analytics eksternal / Slack webhook.
 *
 * Semua fungsi aman dipanggil di SSR / lingkungan tanpa
 * `performance.mark` — kalau API tidak ada, jadi no-op.
 */

const TAG = "[perf]";

function hasPerf(): boolean {
  return (
    typeof performance !== "undefined" &&
    typeof performance.mark === "function" &&
    typeof performance.measure === "function"
  );
}

function beaconUrl(): string | null {
  try {
    const u = (import.meta as any).env?.VITE_PERF_BEACON_URL as string | undefined;
    return u && u.length > 0 ? u : null;
  } catch {
    return null;
  }
}

function sendBeacon(payload: Record<string, unknown>) {
  const url = beaconUrl();
  if (!url) return;
  try {
    const body = JSON.stringify({ ts: Date.now(), ...payload });
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      navigator.sendBeacon(url, body);
    } else if (typeof fetch !== "undefined") {
      void fetch(url, { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

export function perfMark(name: string): void {
  if (!hasPerf()) return;
  try {
    performance.mark(name);
  } catch {
    /* ignore duplicate / invalid name */
  }
}

/**
 * Ukur durasi antara dua mark. Kembalikan durasi (ms) atau null jika
 * pengukuran gagal (mis. mark awal belum ada). Efek samping: log ke
 * console dan (opsional) kirim beacon.
 */
export function perfMeasure(
  name: string,
  fromMark: string,
  toMark?: string,
): number | null {
  if (!hasPerf()) return null;
  try {
    const entry = performance.measure(name, fromMark, toMark);
    const duration = Math.round(entry.duration * 100) / 100;
    // eslint-disable-next-line no-console
    console.info(`${TAG} ${name} = ${duration}ms`, {
      from: fromMark,
      to: toMark ?? "now",
    });
    sendBeacon({ kind: "measure", name, duration, from: fromMark, to: toMark ?? null });
    return duration;
  } catch {
    return null;
  }
}

/** Log satu event sederhana tanpa mark/measure (mis. "chunk error"). */
export function perfEvent(name: string, extra?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.info(`${TAG} event ${name}`, extra ?? {});
  sendBeacon({ kind: "event", name, ...(extra ?? {}) });
}