/**
 * Preferensi ringan yang hidup di localStorage per-device:
 * - aksesibilitas: skala font, kontras tinggi, reduce motion
 * - bahasa aplikasi: id / en (informasional)
 * - penyimpanan: auto-download media di data seluler / wifi
 * - integrasi sosial: URL Facebook/Instagram publik
 *
 * Setter tulis + broadcast custom event supaya semua komponen ikut update
 * tanpa reload.
 */

import { useEffect, useState } from "react";

export type AppPrefs = {
  fontScale: number; // 0.9 – 1.4
  highContrast: boolean;
  reduceMotion: boolean;
  language: "id" | "en";
  autoDownloadWifi: boolean;
  autoDownloadCellular: boolean;
  facebookUrl: string;
  instagramUrl: string;
};

export const DEFAULT_APP_PREFS: AppPrefs = {
  fontScale: 1,
  highContrast: false,
  reduceMotion: false,
  language: "id",
  autoDownloadWifi: true,
  autoDownloadCellular: false,
  facebookUrl: "",
  instagramUrl: "",
};

const KEY = "mcm.app-prefs.v1";
const EV = "mcm:app-prefs-changed";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function sanitize(raw: unknown): AppPrefs {
  const r = (raw ?? {}) as Partial<AppPrefs>;
  return {
    fontScale: clamp(Number.isFinite(r.fontScale) ? Number(r.fontScale) : 1, 0.9, 1.4),
    highContrast: Boolean(r.highContrast),
    reduceMotion: Boolean(r.reduceMotion),
    language: r.language === "en" ? "en" : "id",
    autoDownloadWifi: r.autoDownloadWifi !== false,
    autoDownloadCellular: Boolean(r.autoDownloadCellular),
    facebookUrl: typeof r.facebookUrl === "string" ? r.facebookUrl.slice(0, 200) : "",
    instagramUrl: typeof r.instagramUrl === "string" ? r.instagramUrl.slice(0, 200) : "",
  };
}

let cached: AppPrefs | null = null;

export function getAppPrefs(): AppPrefs {
  if (cached) return cached;
  if (typeof window === "undefined") return DEFAULT_APP_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    cached = raw ? sanitize(JSON.parse(raw)) : DEFAULT_APP_PREFS;
  } catch {
    cached = DEFAULT_APP_PREFS;
  }
  return cached;
}

export function setAppPrefs(patch: Partial<AppPrefs>): AppPrefs {
  const merged = sanitize({ ...getAppPrefs(), ...patch });
  cached = merged;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      /* ignore quota */
    }
    window.dispatchEvent(new CustomEvent(EV));
    applyAppPrefs(merged);
  }
  return merged;
}

export function resetAppPrefs(): AppPrefs {
  return setAppPrefs(DEFAULT_APP_PREFS);
}

/** Terapkan preferensi visual ke <html>. Idempoten. */
export function applyAppPrefs(p: AppPrefs = getAppPrefs()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--app-font-scale", String(p.fontScale));
  root.dataset.highContrast = p.highContrast ? "on" : "off";
  root.dataset.reduceMotion = p.reduceMotion ? "on" : "off";
  root.setAttribute("lang", p.language);
}

if (typeof window !== "undefined" && !(window as any).__appPrefsBind) {
  (window as any).__appPrefsBind = true;
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      cached = null;
      applyAppPrefs();
    }
  });
  // Apply on first import.
  applyAppPrefs();
}

export function useAppPrefs() {
  const [p, setP] = useState<AppPrefs>(() => getAppPrefs());
  useEffect(() => {
    const on = () => setP(getAppPrefs());
    window.addEventListener(EV, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(EV, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  return {
    prefs: p,
    set: (patch: Partial<AppPrefs>) => setP(setAppPrefs(patch)),
    reset: () => setP(resetAppPrefs()),
  };
}