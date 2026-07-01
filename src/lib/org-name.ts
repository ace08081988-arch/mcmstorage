import { useEffect, useState } from "react";

const LS_FULL = "app-org-name";
const LS_SHORT = "app-org-short";
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

/** Reactive hook — updates on cross-tab storage events + local setOrgName. */
export function useOrgName(): { full: string; short: string } {
  const [state, setState] = useState(() => ({ full: getOrgName(), short: getOrgShort() }));
  useEffect(() => {
    const sync = () => setState({ full: getOrgName(), short: getOrgShort() });
    window.addEventListener("storage", sync);
    window.addEventListener("app-org-name-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("app-org-name-changed", sync);
    };
  }, []);
  return state;
}