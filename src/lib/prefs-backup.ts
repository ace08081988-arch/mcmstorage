/**
 * Ekspor & impor preferensi ringan (AppPrefs) sebagai file JSON.
 * Mencakup aksesibilitas (font scale, kontras, reduce motion),
 * bahasa aplikasi, dan penyimpanan (auto-download Wi-Fi / seluler)
 * plus URL integrasi sosial.
 */

import { getAppPrefs, setAppPrefs, DEFAULT_APP_PREFS, type AppPrefs } from "./app-prefs";

const BACKUP_KIND = "mcm.app-prefs.backup";
const BACKUP_VERSION = 1;

export type PrefsBackup = {
  kind: typeof BACKUP_KIND;
  version: number;
  exportedAt: string; // ISO
  app: "MCM Storage";
  prefs: AppPrefs;
};

export function buildBackup(): PrefsBackup {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: "MCM Storage",
    prefs: getAppPrefs(),
  };
}

/** Trigger a download of the current preferences as JSON. */
export function downloadBackup(filename?: string): PrefsBackup {
  const data = buildBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const name = filename ?? `mcm-preferensi-${stamp}.json`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return data;
}

export type ParsedBackup =
  | { ok: true; backup: PrefsBackup }
  | { ok: false; error: string };

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "File bukan JSON yang valid." };
  }
  const r = raw as Partial<PrefsBackup> | null;
  if (!r || typeof r !== "object") {
    return { ok: false, error: "Struktur file tidak dikenali." };
  }
  if (r.kind !== BACKUP_KIND) {
    return { ok: false, error: "Bukan cadangan preferensi MCM Storage." };
  }
  if (typeof r.version !== "number" || r.version > BACKUP_VERSION) {
    return {
      ok: false,
      error: `Versi cadangan (${r.version}) belum didukung — perbarui aplikasi dulu.`,
    };
  }
  if (!r.prefs || typeof r.prefs !== "object") {
    return { ok: false, error: "Bagian preferensi kosong pada file." };
  }
  const backup: PrefsBackup = {
    kind: BACKUP_KIND,
    version: r.version,
    exportedAt: typeof r.exportedAt === "string" ? r.exportedAt : new Date().toISOString(),
    app: "MCM Storage",
    prefs: { ...DEFAULT_APP_PREFS, ...(r.prefs as Partial<AppPrefs>) },
  };
  return { ok: true, backup };
}

/** Terapkan hasil parse (sudah tervalidasi) — mengembalikan AppPrefs final setelah sanitize. */
export function applyBackup(backup: PrefsBackup): AppPrefs {
  return setAppPrefs(backup.prefs);
}

export async function readFileAsText(file: File): Promise<string> {
  if (typeof (file as any).text === "function") return (file as any).text();
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsText(file);
  });
}