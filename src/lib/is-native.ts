/**
 * Deteksi runtime APK (Capacitor) tanpa mengimpor plugin apa pun.
 *
 * Dipakai untuk mematikan mekanisme khusus web (service worker, cache
 * buster berbasis /api/version, auto-fullscreen browser) di dalam APK,
 * karena di sana mekanisme itu tidak berguna dan justru bikin aplikasi
 * terasa berat / reload sendiri.
 */
export function isNativeApp(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    return w.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}
