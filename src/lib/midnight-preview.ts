/**
 * Midnight Indigo — mode pratinjau tampilan.
 *
 * Berdiri sendiri dari pipeline preset `appearance-init` supaya bisa
 * dinyalakan/dimatikan cepat tanpa menyentuh preset tersimpan atau sinkron
 * cloud. Toggle hanya menulis satu flag; efek visualnya di-scope ke halaman
 * yang memasang <MidnightScope /> (saat ini Beranda dan Gudang) lewat
 * `html[data-midnight="1"][data-midnight-page="1"]`.
 */
import { useEffect, useState } from "react";

export const MIDNIGHT_LS_KEY = "app-midnight-preview";
export const MIDNIGHT_EVENT = "app:midnight-preview";

export function isMidnightEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MIDNIGHT_LS_KEY) === "1";
}

/** Terapkan flag ke <html> tanpa menulis localStorage. */
export function applyMidnightPreview(on = isMidnightEnabled()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (on) root.dataset.midnight = "1";
  else delete root.dataset.midnight;
}

export function setMidnightEnabled(on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MIDNIGHT_LS_KEY, on ? "1" : "0");
  applyMidnightPreview(on);
  window.dispatchEvent(new CustomEvent(MIDNIGHT_EVENT, { detail: on }));
}

/** State toggle yang ikut sinkron antar komponen/tab. */
export function useMidnightPreview(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(isMidnightEnabled());
    const sync = () => setOn(isMidnightEnabled());
    window.addEventListener(MIDNIGHT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(MIDNIGHT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [on, setMidnightEnabled];
}

/**
 * Menandai halaman aktif sebagai target Midnight Indigo selama komponen
 * ter-mount. Render null — aman ditaruh di mana saja dalam pohon halaman.
 */
export function MidnightScope() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.midnightPage = "1";
    return () => {
      delete root.dataset.midnightPage;
    };
  }, []);
  return null;
}
