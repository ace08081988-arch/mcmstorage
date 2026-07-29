/**
 * Preferensi tata letak PDF ekspor: kerapatan margin + skala font.
 * Disimpan lokal (per device) supaya ekspor langsung memakai setelan
 * terakhir tanpa perlu round-trip ke backend.
 */
import { useEffect, useState } from "react";

export type PdfDensity = "rapat" | "normal" | "lega";

export type PdfPrefs = {
  /** Kerapatan margin dokumen. */
  density: PdfDensity;
  /** Pengali ukuran font tabel/isi (0.8 – 1.3). */
  fontScale: number;
};

export const DEFAULT_PDF_PREFS: PdfPrefs = { density: "normal", fontScale: 1 };

const LS_KEY = "app-pdf-prefs";
export const PDF_PREFS_EVENT = "app-pdf-prefs-changed";

const clampScale = (n: number) =>
  Math.min(1.3, Math.max(0.8, Math.round(n * 100) / 100));

export function getPdfPrefs(): PdfPrefs {
  if (typeof window === "undefined") return DEFAULT_PDF_PREFS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_PDF_PREFS;
    const p = JSON.parse(raw) as Partial<PdfPrefs>;
    const density: PdfDensity =
      p.density === "rapat" || p.density === "lega" ? p.density : "normal";
    const fontScale = typeof p.fontScale === "number" && Number.isFinite(p.fontScale)
      ? clampScale(p.fontScale)
      : 1;
    return { density, fontScale };
  } catch {
    return DEFAULT_PDF_PREFS;
  }
}

export function setPdfPrefs(next: Partial<PdfPrefs>) {
  if (typeof window === "undefined") return;
  const merged: PdfPrefs = { ...getPdfPrefs(), ...next };
  merged.fontScale = clampScale(merged.fontScale);
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent(PDF_PREFS_EVENT));
  } catch { /* ignore */ }
}

export function resetPdfPrefs() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_KEY);
    window.dispatchEvent(new CustomEvent(PDF_PREFS_EVENT));
  } catch { /* ignore */ }
}

/** Pengali margin per tingkat kerapatan. */
export function densityFactor(d: PdfDensity): number {
  return d === "rapat" ? 0.7 : d === "lega" ? 1.35 : 1;
}

/** Hook reaktif untuk UI pengaturan. */
export function usePdfPrefs(): PdfPrefs {
  const [state, setState] = useState<PdfPrefs>(() => getPdfPrefs());
  useEffect(() => {
    const sync = () => setState(getPdfPrefs());
    window.addEventListener("storage", sync);
    window.addEventListener(PDF_PREFS_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(PDF_PREFS_EVENT, sync);
    };
  }, []);
  return state;
}
