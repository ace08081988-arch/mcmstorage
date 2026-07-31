/**
 * Jembatan opsional ke plugin Capacitor untuk mengubah routing audio
 * OS Android (earpiece ↔ speakerphone) selama panggilan.
 *
 * Plugin native tidak dipasang secara default; util ini feature-detect
 * dan silently no-op jika tidak ada. Web build dan APK bisa pakai file
 * yang sama tanpa perubahan.
 */

type NativeAudioRoute = {
  setSpeakerOn: (on: boolean) => Promise<void>;
  available: boolean;
};

let cached: NativeAudioRoute | null = null;

export async function getNativeAudioRoute(): Promise<NativeAudioRoute> {
  if (cached) return cached;
  const noop: NativeAudioRoute = {
    setSpeakerOn: async () => { /* no-op */ },
    available: false,
  };
  if (
    typeof window === "undefined" ||
    !(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.()
  ) {
    cached = noop;
    return cached;
  }
  // Plugin resolusi dinamis — jika belum terpasang, tetap noop.
  cached = noop;
  return cached;
}