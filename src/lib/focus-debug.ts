/**
 * Mode debug fokus (DEV/TEST SAJA).
 *
 * Menampilkan dua hal yang selama ini tak kasat mata saat dialog pratinjau
 * ditutup:
 *  1. TUMPUKAN layer portal Radix yang sedang terbuka (popover → select → menu)
 *     beserta pemicu tiap layer.
 *  2. TARGET pemulihan fokus yang akhirnya dipilih (pemicu asli, hasil
 *     selector stabil, tetangga terdekat, atau fallback).
 *
 * Cara mengaktifkan (di dev/preview):
 *   - URL: tambahkan `?focus-debug=1`
 *   - Console: `__waFocusDebug.enable()` lalu ulangi aksinya
 *   - Test: `setFocusDebugEnabled(true)`
 * Matikan lagi dengan `__waFocusDebug.disable()`.
 *
 * Di build produksi seluruh modul jadi no-op: tidak ada listener, tidak ada
 * log, dan `window.__waFocusDebug` tidak dipasang.
 */

const STORAGE_KEY = "mcm.focus-debug";
const MAX_EVENTS = 100;

/** Hanya aktif di dev atau saat menjalankan tes. */
export const FOCUS_DEBUG_ALLOWED: boolean = (() => {
  try {
    const env = import.meta.env as { DEV?: boolean; MODE?: string } | undefined;
    return !!env?.DEV || env?.MODE === "test" || process.env["NODE_ENV"] === "test";
  } catch {
    return false;
  }
})();

export type FocusDebugLayer = {
  /** Deskripsi ringkas layer: role/tag + testid/id kalau ada. */
  layer: string;
  /** Pemicu yang memegang fokus tepat sebelum layer ini terbuka. */
  trigger: string | null;
  /** Jejak posisi pemicu (selector stabil + indeks fokusable). */
  anchor: { selector: string | null; index: number } | null;
};

export type FocusDebugEvent = {
  t: number;
  type:
    | "layer-open"
    | "layer-close"
    | "restore-layer-trigger"
    | "dialog-close-restore"
    | "refocus"
    | "note";
  detail: string;
  /** Tumpukan layer saat event terjadi (paling bawah dulu). */
  layers: FocusDebugLayer[];
};

let enabled = false;
const events: FocusDebugEvent[] = [];
let layers: FocusDebugLayer[] = [];

function readInitial(): boolean {
  if (!FOCUS_DEBUG_ALLOWED || typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("focus-debug") === "1") return true;
    return window.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isFocusDebugEnabled(): boolean {
  return FOCUS_DEBUG_ALLOWED && enabled;
}

export function setFocusDebugEnabled(v: boolean) {
  if (!FOCUS_DEBUG_ALLOWED) return;
  enabled = v;
  try {
    if (typeof window !== "undefined") {
      if (v) window.localStorage?.setItem(STORAGE_KEY, "1");
      else window.localStorage?.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
  if (!v) {
    events.length = 0;
    layers = [];
  }
}

/** Label pendek & aman untuk sebuah elemen (tidak memuat isi teks panjang). */
export function describeEl(el: Element | null | undefined): string | null {
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  const testId = el.getAttribute("data-testid");
  const role = el.getAttribute("role");
  const label = el.getAttribute("aria-label");
  const id = el.id;
  const bits = [tag];
  if (role) bits.push(`role=${role}`);
  if (testId) bits.push(`testid=${testId}`);
  else if (id) bits.push(`#${id}`);
  else if (label) bits.push(`aria=${label.slice(0, 32)}`);
  return bits.join(" ");
}

/** Perbarui snapshot tumpukan layer portal. */
export function focusDebugSetLayers(next: FocusDebugLayer[]) {
  if (!isFocusDebugEnabled()) return;
  layers = next;
}

export function focusDebugLog(type: FocusDebugEvent["type"], detail: string) {
  if (!isFocusDebugEnabled()) return;
  const ev: FocusDebugEvent = { t: Date.now(), type, detail, layers: [...layers] };
  events.push(ev);
  if (events.length > MAX_EVENTS) events.shift();
  try {
    // eslint-disable-next-line no-console
    console.info(`[focus-debug] ${type}: ${detail}`, { layers: ev.layers });
  } catch {
    /* ignore */
  }
}

export function getFocusDebugState() {
  return { enabled: isFocusDebugEnabled(), layers: [...layers], events: [...events] };
}

export function clearFocusDebug() {
  events.length = 0;
  layers = [];
}

/** Pasang helper console (idempoten, dev/test saja). */
export function installFocusDebug() {
  if (!FOCUS_DEBUG_ALLOWED || typeof window === "undefined") return;
  enabled = enabled || readInitial();
  (window as unknown as Record<string, unknown>)["__waFocusDebug"] = {
    enable: () => setFocusDebugEnabled(true),
    disable: () => setFocusDebugEnabled(false),
    state: getFocusDebugState,
    clear: clearFocusDebug,
  };
}
