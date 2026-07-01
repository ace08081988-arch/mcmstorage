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

// Persist lock config to Capacitor Preferences (survives app kill on native)
// in addition to localStorage (used for sync access in UI).
async function prefsGet(key: string): Promise<string | null> {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key });
    return value ?? null;
  } catch {
    return null;
  }
}
async function prefsSet(key: string, value: string) {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key, value });
  } catch {}
}
async function prefsRemove(key: string) {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key });
  } catch {}
}

// Call once on app boot (per uid) to copy persisted config from Capacitor
// Preferences into localStorage so the sync getters see it.
export async function hydrateLockConfig(uid: string): Promise<void> {
  try {
    const key = cfgKey(uid);
    const localRaw = localStorage.getItem(key);
    const persisted = await prefsGet(key);
    if (persisted && persisted !== localRaw) {
      localStorage.setItem(key, persisted);
      window.dispatchEvent(new Event(APP_LOCK_EVENT));
    } else if (!persisted && localRaw) {
      // First migration: mirror existing localStorage value into Preferences
      await prefsSet(key, localRaw);
    }
  } catch {}
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
    const key = cfgKey(uid);
    if (cfg) {
      const serialized = JSON.stringify(cfg);
      localStorage.setItem(key, serialized);
      void prefsSet(key, serialized);
    } else {
      localStorage.removeItem(key);
      void prefsRemove(key);
    }
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

// Biometric (Capacitor native). Returns detailed status so UI dapat
// menjelaskan alasan tidak tersedia (tidak terdaftar / hanya web / dsb).
export type BiometricStatus = {
  available: boolean;
  native: boolean;
  reason?: string;
  code?: string;
  biometryType?: number;
  platform?: "android" | "ios" | "web";
  pluginLoaded?: boolean;
  enrolled?: boolean; // ada sidik jari terdaftar di sistem
  permission?: "granted" | "denied" | "unknown";
};

function getPlatform(): "android" | "ios" | "web" {
  try {
    const w = window as unknown as { Capacitor?: { getPlatform?: () => string } };
    const p = w.Capacitor?.getPlatform?.();
    if (p === "android" || p === "ios") return p;
    return "web";
  } catch {
    return "web";
  }
}

function isNative(): boolean {
  try {
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    return !!w.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

export async function checkBiometricStatus(): Promise<BiometricStatus> {
  const native = isNative();
  const platform = getPlatform();
  if (!native) {
    return {
      available: false,
      native: false,
      platform,
      pluginLoaded: false,
      enrolled: false,
      permission: "unknown",
      reason: "Hanya tersedia di APK Android (bukan preview browser)",
    };
  }
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    const info = await BiometricAuth.checkBiometry();
    const code = info.code as string | undefined;
    // Kode dari plugin: biometryNotEnrolled = tidak ada sidik jari.
    // biometryNotAvailable = hardware tidak ada / dimatikan.
    // noDeviceCredential = tidak ada PIN/pola sistem.
    const enrolled = info.isAvailable
      ? true
      : code === "biometryNotEnrolled"
        ? false
        : code === "biometryNotAvailable" || code === "noDeviceCredential"
          ? false
          : undefined; // tidak diketahui
    // Plugin ini tidak butuh runtime permission terpisah di Android modern
    // (USE_BIOMETRIC declared di manifest). Anggap granted bila plugin
    // berhasil dimuat & checkBiometry tidak melempar.
    const permission: "granted" | "denied" | "unknown" =
      code === "authenticationFailed" || code === "userLockout" ? "denied" : "granted";
    return {
      available: !!info.isAvailable,
      native: true,
      platform,
      pluginLoaded: true,
      enrolled: enrolled ?? undefined,
      permission,
      reason: info.reason,
      code,
      biometryType: info.biometryType as unknown as number,
    };
  } catch (e) {
    return {
      available: false,
      native: true,
      platform,
      pluginLoaded: false,
      enrolled: undefined,
      permission: "unknown",
      reason: e instanceof Error ? e.message : "Plugin biometrik gagal dimuat",
    };
  }
}

export async function isBiometricAvailable(): Promise<boolean> {
  return (await checkBiometricStatus()).available;
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

// Coba buka layar pendaftaran sidik jari di Pengaturan Sistem (Android/iOS).
// Mengembalikan `true` bila salah satu intent berhasil dibuka.
export async function openBiometricEnrollment(): Promise<boolean> {
  if (!isNative()) return false;
  let AppLauncher: typeof import("@capacitor/app-launcher").AppLauncher | null = null;
  try {
    AppLauncher = (await import("@capacitor/app-launcher")).AppLauncher;
  } catch {
    return false;
  }
  // Urutan intent Android: khusus enroll biometrik → fingerprint → security → settings umum.
  // iOS: skema "app-settings:" langsung ke pengaturan aplikasi.
  const candidates = [
    "intent:#Intent;action=android.settings.BIOMETRIC_ENROLL;end",
    "intent:#Intent;action=android.settings.FINGERPRINT_ENROLL;end",
    "intent:#Intent;action=android.settings.SECURITY_SETTINGS;end",
    "intent:#Intent;action=android.settings.SETTINGS;end",
    "app-settings:",
  ];
  for (const url of candidates) {
    try {
      const can = await AppLauncher.canOpenUrl({ url });
      if (!can.value) continue;
      const res = await AppLauncher.openUrl({ url });
      if (res.completed) return true;
    } catch {
      // coba kandidat berikutnya
    }
  }
  // Fallback terakhir: paksa buka Settings umum tanpa cek.
  try {
    await AppLauncher.openUrl({ url: "intent:#Intent;action=android.settings.SETTINGS;end" });
    return true;
  } catch {
    return false;
  }
}

// Buka halaman detail izin aplikasi (App Info) langsung untuk paket ini.
// Ini adalah rute yang diperlukan saat izin biometrik ditolak permanen.
export async function openAppPermissionSettings(
  packageId = "biz.mcmstorage.app",
): Promise<boolean> {
  if (!isNative()) return false;
  let AppLauncher: typeof import("@capacitor/app-launcher").AppLauncher | null = null;
  try {
    AppLauncher = (await import("@capacitor/app-launcher")).AppLauncher;
  } catch {
    return false;
  }
  const pkg = encodeURIComponent(packageId);
  // Urutan Android: detail izin app → detail app info → pengaturan biometrik → security → settings umum.
  // iOS: skema "app-settings:" membuka halaman aplikasi ini di Settings.
  const candidates = [
    `intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;package=${packageId};S.android.provider.extra.APP_PACKAGE=${packageId};end`,
    `package:${packageId}`,
    `intent://${pkg}/#Intent;scheme=package;action=android.settings.APPLICATION_DETAILS_SETTINGS;end`,
    "intent:#Intent;action=android.settings.BIOMETRIC_ENROLL;end",
    "intent:#Intent;action=android.settings.SECURITY_SETTINGS;end",
    "intent:#Intent;action=android.settings.SETTINGS;end",
    "app-settings:",
  ];
  for (const url of candidates) {
    try {
      const can = await AppLauncher.canOpenUrl({ url });
      if (!can.value) continue;
      const res = await AppLauncher.openUrl({ url });
      if (res.completed) return true;
    } catch {
      // coba kandidat berikutnya
    }
  }
  try {
    await AppLauncher.openUrl({ url: "intent:#Intent;action=android.settings.SETTINGS;end" });
    return true;
  } catch {
    return false;
  }
}