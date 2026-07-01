import { useEffect, useState } from "react";

const LS_FULL = "app-org-name";
const LS_SHORT = "app-org-short";
const LS_LOGO = "app-org-logo";
const LS_BRAND = "app-org-brand";
export const DEFAULT_ORG_NAME = "MCM Storage";
export const DEFAULT_ORG_SHORT = "MCM";

function read(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    return v && v.trim() ? v : fallback;
  } catch {
    return fallback;
  }
}

export function getOrgName(): string {
  return read(LS_FULL, DEFAULT_ORG_NAME);
}

export function getOrgShort(): string {
  return read(LS_SHORT, DEFAULT_ORG_SHORT);
}

export function getOrgLogo(): string {
  return read(LS_LOGO, "");
}

/** Brand color as CSS color string (oklch/hex). Empty = use theme accent. */
export function getOrgBrand(): string {
  return read(LS_BRAND, "");
}

export function setOrgName(full: string, short: string) {
  if (typeof window === "undefined") return;
  const f = full.trim() || DEFAULT_ORG_NAME;
  const s = (short.trim() || f.slice(0, 3)).toUpperCase().slice(0, 6);
  try {
    window.localStorage.setItem(LS_FULL, f);
    window.localStorage.setItem(LS_SHORT, s);
    window.dispatchEvent(new CustomEvent("app-org-name-changed"));
  } catch { /* ignore */ }
}

/** Set logo as data URL (or empty to clear). */
export function setOrgLogo(dataUrl: string) {
  if (typeof window === "undefined") return;
  try {
    if (dataUrl) window.localStorage.setItem(LS_LOGO, dataUrl);
    else window.localStorage.removeItem(LS_LOGO);
    window.dispatchEvent(new CustomEvent("app-org-name-changed"));
  } catch { /* ignore */ }
}

/** Set brand color hex (e.g. "#10b981") or empty to fall back to theme. */
export function setOrgBrand(color: string) {
  if (typeof window === "undefined") return;
  const c = color.trim();
  try {
    if (c) window.localStorage.setItem(LS_BRAND, c);
    else window.localStorage.removeItem(LS_BRAND);
    window.dispatchEvent(new CustomEvent("app-org-name-changed"));
    applyBrandColor();
  } catch { /* ignore */ }
}

/** Push brand color into CSS custom properties. Called on load + change. */
export function applyBrandColor() {
  if (typeof document === "undefined") return;
  const c = getOrgBrand();
  const root = document.documentElement;
  if (c) {
    root.style.setProperty("--primary", c);
    root.style.setProperty("--ring", c);
    root.dataset.orgBrand = "1";
  } else if (root.dataset.orgBrand === "1") {
    // Only clear when we previously overrode — let appearance-settings own
    // the value otherwise.
    delete root.dataset.orgBrand;
    // Re-run appearance so the accent preset restores.
    try {
      const evt = new CustomEvent("app-appearance-reapply");
      window.dispatchEvent(evt);
    } catch { /* ignore */ }
  }
}

/** Reactive hook — updates on cross-tab storage events + local setOrgName. */
export function useOrgName(): { full: string; short: string; logo: string; brand: string } {
  const [state, setState] = useState(() => ({
    full: getOrgName(),
    short: getOrgShort(),
    logo: getOrgLogo(),
    brand: getOrgBrand(),
  }));
  useEffect(() => {
    const sync = () => setState({
      full: getOrgName(),
      short: getOrgShort(),
      logo: getOrgLogo(),
      brand: getOrgBrand(),
    });
    window.addEventListener("storage", sync);
    window.addEventListener("app-org-name-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("app-org-name-changed", sync);
    };
  }, []);
  return state;
}