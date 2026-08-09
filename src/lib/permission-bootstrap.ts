import { Capacitor } from "@capacitor/core";

export type NativePermissionKey = "push" | "camera" | "photos" | "location";
export type NativePermissionState = "granted" | "denied" | "prompt" | "unknown";

/**
 * KEBIJAKAN IZIN (Sprint 4 — Android release readiness)
 *
 * Aplikasi TIDAK meminta izin apa pun saat pertama kali dibuka. Google Play
 * menolak "permission bombing", dan user yang ditodong 4 dialog sekaligus
 * cenderung menekan Tolak — setelah itu Android menandai izin sebagai
 * *permanently denied* dan fitur intinya mati permanen.
 *
 * Aturannya sekarang:
 *   • Kamera & galeri  → diminta saat user menekan tombol ambil/pilih foto
 *                        (Capacitor Camera meminta sendiri saat dipanggil).
 *   • Lokasi           → diminta saat user menekan tombol GPS
 *                        (src/lib/get-location.ts).
 *   • Notifikasi       → diminta setelah user menekan "Aktifkan notifikasi"
 *                        (src/lib/native-push.ts / PushPermissionPrompt).
 *
 * Fungsi di bawah hanya MEMBACA status izin (tanpa dialog) supaya UI bisa
 * menampilkan alasan + jalan pintas ke Settings kalau izin ditolak permanen.
 */
export async function bootstrapNativePermissions() {
  // Sengaja no-op: tidak ada permintaan izin saat startup, baik di web
  // maupun native. Dipertahankan sebagai satu titik kebijakan agar tidak
  // ada kode lain yang diam-diam menambahkan prompt startup.
  return;
}

/** Baca status izin native tanpa memunculkan dialog sistem. */
export async function checkNativePermission(
  key: NativePermissionKey,
): Promise<NativePermissionState> {
  if (!Capacitor.isNativePlatform()) return "unknown";
  try {
    if (key === "push") {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      return normalize((await PushNotifications.checkPermissions()).receive);
    }
    if (key === "location") {
      const { Geolocation } = await import("@capacitor/geolocation");
      return normalize((await Geolocation.checkPermissions()).location);
    }
    const { Camera } = await import("@capacitor/camera");
    const status = await Camera.checkPermissions();
    return normalize(key === "camera" ? status.camera : status.photos);
  } catch {
    return "unknown";
  }
}

function normalize(value: string | undefined): NativePermissionState {
  if (value === "granted" || value === "denied" || value === "prompt") return value;
  if (value === "limited") return "granted"; // akses foto parsial Android 14+
  return "unknown";
}
