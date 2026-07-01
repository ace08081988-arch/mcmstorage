/**
 * App mode flag — memungkinkan build "chat-only" dari codebase yang sama.
 *
 * Sumber nilai (prioritas):
 *   1. `localStorage["mcm.appMode"]` — untuk preview/testing di device
 *      tanpa rebuild.
 *   2. `import.meta.env.VITE_APP_MODE` — untuk build produksi (mis.
 *      di-set ke "chat" saat build APK/subdomain chat-only).
 *   3. default "full" — semua fitur seperti biasa.
 *
 * Nilai valid: "full" | "chat".
 *
 * Di mode "chat", sidebar hanya menampilkan grup Komunikasi + Akun +
 * Sistem, dan halaman beranda otomatis diarahkan ke /chat. Data + akun
 * Lovable Cloud tetap sama persis dengan build "full".
 */
export type AppMode = "full" | "chat";

const LS_KEY = "mcm.appMode";

function readLs(): AppMode | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(LS_KEY);
    if (v === "full" || v === "chat") return v;
  } catch {
    /* SSR / disabled storage */
  }
  return null;
}

function readEnv(): AppMode | null {
  const v = (import.meta.env.VITE_APP_MODE as string | undefined)?.toLowerCase();
  if (v === "full" || v === "chat") return v as AppMode;
  return null;
}

export function getAppMode(): AppMode {
  return readLs() ?? readEnv() ?? "full";
}

export function isChatOnly(): boolean {
  return getAppMode() === "chat";
}

/**
 * Simpan override lokal (dev/testing). Kirim event supaya listener UI
 * merender ulang tanpa perlu reload manual.
 */
export function setAppModeOverride(mode: AppMode | null) {
  if (typeof window === "undefined") return;
  try {
    if (mode === null) window.localStorage.removeItem(LS_KEY);
    else window.localStorage.setItem(LS_KEY, mode);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("mcm:app-mode-change"));
}

/**
 * Grup sidebar yang tetap tampil di mode chat-only. Grup lain
 * (Operasional, Keuangan, Utama/Beranda) disembunyikan.
 */
export const CHAT_ONLY_GROUP_LABELS: ReadonlySet<string> = new Set([
  "Komunikasi",
  "Akun",
  "Sistem",
]);