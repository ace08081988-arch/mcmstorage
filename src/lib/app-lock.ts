// App-lock storage, hashing, and event helpers.
// Methods: "pin" | "pattern" | "biometric". Multiple methods can be enabled,
// but only ONE primary credential (pin or pattern) is stored at a time;
// biometric is an additional unlock shortcut on supported devices.

export type LockMethod = "pin" | "pattern" | "biometric";

export type LockConfig = {
  method: "pin" | "pattern"; // primary stored credential
  hash: string; // sha-256 hex of secret
  salt: string; // random salt
  biometric: boolean; // also allow biometric unlock
  idleMs: number; // 0 = disabled
  lockOnHide: boolean;
};

export const APP_LOCK_EVENT = "app-lock:changed";
export const APP_LOCK_REQUEST = "app-lock:lock-now";

function cfgKey(uid: string) {
  return `app-lock:cfg:${uid}`;
}
function lockedKey(uid: string) {
  return `app-lock:locked:${uid}`;
}

export function getLockConfig(uid: string): LockConfig | null {
  try {
    const raw = localStorage.getItem(cfgKey(uid));
    if (!raw) return null;
    return JSON.parse(raw) as LockConfig;
  } catch {
    return null;
  }
}

export function setLockConfig(uid: string, cfg: LockConfig | null) {
  try {
    if (cfg) localStorage.setItem(cfgKey(uid), JSON.stringify(cfg));
    else localStorage.removeItem(cfgKey(uid));
    window.dispatchEvent(new Event(APP_LOCK_EVENT));
  } catch {}
}

export function isLocked(uid: string): boolean {
  try {
    return localStorage.getItem(lockedKey(uid)) === "1";
  } catch {
    return false;
  }
}

export function setLocked(uid: string, locked: boolean) {
  try {
    if (locked) localStorage.setItem(lockedKey(uid), "1");
    else localStorage.removeItem(lockedKey(uid));
    window.dispatchEvent(new Event(APP_LOCK_EVENT));
  } catch {}
}

export function requestLockNow() {
  window.dispatchEvent(new Event(APP_LOCK_REQUEST));
}

export async function hashSecret(secret: string, salt: string): Promise<string> {
  const enc = new TextEncoder().encode(`${salt}:${secret}`);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomSalt(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifySecret(
  cfg: LockConfig,
  secret: string,
): Promise<boolean> {
  const h = await hashSecret(secret, cfg.salt);
  return h === cfg.hash;
}

// Biometric (Capacitor native). Returns false on web/unsupported.
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    const info = await BiometricAuth.checkBiometry();
    return !!info.isAvailable;
  } catch {
    return false;
  }
}

export async function authenticateBiometric(reason: string): Promise<boolean> {
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: "Batal",
      allowDeviceCredential: false,
      iosFallbackTitle: "Gunakan PIN/Pola",
      androidTitle: "Buka Kunci Aplikasi",
      androidSubtitle: reason,
      androidConfirmationRequired: false,
    });
    return true;
  } catch {
    return false;
  }
}