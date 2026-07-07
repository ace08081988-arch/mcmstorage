/**
 * Sidik jari device dari browser/native shell. IP ditambahkan di server.
 * Stabil cukup untuk membedakan instalasi/browser, tidak mengikuti pindah jaringan.
 */
export async function getClientDeviceFingerprint(): Promise<string> {
  if (typeof window === "undefined") return "ssr";
  const installId = getOrCreateDeviceInstallId();
  const parts = [
    installId,
    navigator.userAgent || "",
    navigator.language || "",
    (navigator.languages || []).join(","),
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    navigator.hardwareConcurrency?.toString() || "",
    // @ts-expect-error deviceMemory tidak ada di semua browser
    navigator.deviceMemory?.toString() || "",
  ];
  const raw = parts.join("|");
  const buf = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const DEVICE_INSTALL_ID_KEY = "mcm_device_install_id_v1";

function getOrCreateDeviceInstallId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_INSTALL_ID_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `mcm-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage.setItem(DEVICE_INSTALL_ID_KEY, id);
    return id;
  } catch {
    return "storage-unavailable";
  }
}

export function trustedKey(userId: string, deviceHash: string) {
  return `mcm_device_trusted_${userId}_${deviceHash}`;
}

export function markDeviceTrustedLocal(userId: string, deviceHash: string) {
  try {
    localStorage.setItem(trustedKey(userId, deviceHash), "1");
  } catch {}
}

export function isDeviceTrustedLocal(userId: string, deviceHash: string) {
  try {
    return localStorage.getItem(trustedKey(userId, deviceHash)) === "1";
  } catch {
    return false;
  }
}

export function clearDeviceTrustedLocal(userId: string, deviceHash: string) {
  try {
    localStorage.removeItem(trustedKey(userId, deviceHash));
  } catch {}
}