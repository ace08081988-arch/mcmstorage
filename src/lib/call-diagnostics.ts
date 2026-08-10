/**
 * Log diagnosa panggilan (WebRTC).
 *
 * Kenapa perlu: kegagalan recovery panggilan terjadi di lapangan, di HP,
 * tanpa DevTools. Tanpa jejak yang tersimpan kita hanya menebak. Modul ini
 * mencatat transisi `iceConnectionState`, `signalingState`,
 * `iceGatheringState`, sinyal SDP yang masuk/keluar, dan setiap keputusan
 * recovery/finalize — lalu menyimpannya di localStorage (ring buffer)
 * sehingga bisa dibuka & disalin setelah panggilan berakhir.
 */
import { peekUserIdSync, scopedKey } from "@/lib/user-scoped-storage";

export type CallLogEntry = {
  /** epoch ms */
  t: number;
  callId: string;
  /** kategori pendek: ice | sig | gather | signal | recovery | finalize | info */
  kind: "ice" | "sig" | "gather" | "signal" | "recovery" | "finalize" | "info";
  msg: string;
  data?: Record<string, unknown>;
};

const BASE = "mcm:callDiag:v1";
const MAX_ENTRIES = 400;

let buffer: CallLogEntry[] | null = null;
const listeners = new Set<(entries: CallLogEntry[]) => void>();

function storageKey(): string {
  return scopedKey(BASE, peekUserIdSync());
}

function load(): CallLogEntry[] {
  if (buffer) return buffer;
  if (typeof window === "undefined") return (buffer = []);
  try {
    const raw = window.localStorage.getItem(storageKey());
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    buffer = Array.isArray(parsed) ? (parsed as CallLogEntry[]) : [];
  } catch {
    buffer = [];
  }
  return buffer;
}

function persist() {
  if (typeof window === "undefined" || !buffer) return;
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(buffer));
  } catch {
    /* kuota penuh / private mode — log tetap hidup di memori */
  }
}

/** Catat satu event diagnosa. Aman dipanggil dari mana saja (tidak melempar). */
export function logCall(
  callId: string,
  kind: CallLogEntry["kind"],
  msg: string,
  data?: Record<string, unknown>,
): void {
  try {
    const list = load();
    list.push({ t: Date.now(), callId, kind, msg, data });
    if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
    persist();
    for (const fn of listeners) fn([...list]);
  } catch {
    /* diagnosa tidak boleh mematikan panggilan */
  }
}

/** Seluruh entri (terlama → terbaru). */
export function getCallLogs(callId?: string): CallLogEntry[] {
  const list = [...load()];
  return callId ? list.filter((e) => e.callId === callId) : list;
}

export function clearCallLogs(): void {
  buffer = [];
  persist();
  for (const fn of listeners) fn([]);
}

export function subscribeCallLogs(fn: (entries: CallLogEntry[]) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function formatTime(t: number): string {
  const d = new Date(t);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Teks siap salin/kirim ke WhatsApp untuk diagnosa. */
export function formatCallLogs(entries: CallLogEntry[]): string {
  const head = [
    "=== Log Diagnosa Panggilan (Ace) ===",
    `Dibuat: ${new Date().toLocaleString("id-ID")}`,
    `UA: ${typeof navigator !== "undefined" ? navigator.userAgent : "-"}`,
    `Jumlah entri: ${entries.length}`,
    "",
  ].join("\n");
  const body = entries
    .map((e) => {
      const extra = e.data && Object.keys(e.data).length ? ` ${JSON.stringify(e.data)}` : "";
      return `${formatTime(e.t)} [${e.kind}] ${e.msg}${extra} (call ${e.callId.slice(0, 8)})`;
    })
    .join("\n");
  return head + body;
}
