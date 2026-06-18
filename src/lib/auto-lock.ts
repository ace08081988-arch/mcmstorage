export const AUTO_LOCK_EVENT = "auto-lock-changed";

export function autoLockKey(uid: string) {
  return `auto-lock:${uid}`;
}

export function isAutoLockEnabled(uid: string): boolean {
  try {
    return localStorage.getItem(autoLockKey(uid)) === "1";
  } catch {
    return false;
  }
}

export function setAutoLockEnabled(uid: string, enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(autoLockKey(uid), "1");
    else localStorage.removeItem(autoLockKey(uid));
    window.dispatchEvent(new Event(AUTO_LOCK_EVENT));
  } catch {}
}