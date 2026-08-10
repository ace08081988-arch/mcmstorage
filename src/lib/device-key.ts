/**
 * Sidik jari perangkat versi *sinkron* (ringan) untuk namespacing pengaturan
 * yang harus dibaca saat modul pertama kali dievaluasi.
 *
 * Berbeda dengan `getClientDeviceFingerprint()` (SHA-256, async) yang dipakai
 * untuk keamanan device-session, fungsi ini hanya perlu "cukup unik" untuk
 * membedakan perangkat/instalasi yang dipakai user yang sama, dan WAJIB
 * sinkron karena dipakai di initializer localStorage.
 *
 * Hasilnya di-cache di localStorage supaya stabil walau UA sedikit berubah
 * (mis. update Chrome/WebView).
 */
const CACHE_KEY = "mcm:deviceKey";

let cached: string | null = null;

function hash(input: string): string {
  // FNV-1a 32-bit, cukup untuk namespacing (bukan untuk keamanan).
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Kunci perangkat sinkron; "ssr" saat tidak ada window. */
export function peekDeviceKeySync(): string {
  if (cached) return cached;
  if (typeof window === "undefined") return "ssr";
  try {
    const saved = window.localStorage.getItem(CACHE_KEY);
    if (saved) {
      cached = saved;
      return saved;
    }
  } catch {
    /* mode privat — lanjut hitung tanpa cache */
  }

  const nav = window.navigator;
  const parts = [
    nav.userAgent || "",
    nav.platform || "",
    nav.language || "",
    `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}x${window.screen?.colorDepth ?? 0}`,
    String(window.devicePixelRatio ?? 0),
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    String(nav.hardwareConcurrency ?? 0),
  ];
  const key = hash(parts.join("|"));
  cached = key;
  try {
    window.localStorage.setItem(CACHE_KEY, key);
  } catch {
    /* abaikan */
  }
  return key;
}
