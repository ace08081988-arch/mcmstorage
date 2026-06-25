import { Capacitor } from "@capacitor/core";

export type GeoResult = { lat: number; lng: number; accuracy?: number };

export class GeoError extends Error {
  code: "unsupported" | "denied" | "unavailable" | "timeout" | "insecure" | "unknown";
  hint?: string;
  constructor(code: GeoError["code"], message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

function isSecure(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

async function getNative(): Promise<GeoResult> {
  const { Geolocation } = await import("@capacitor/geolocation");
  try {
    const perm = await Geolocation.checkPermissions();
    if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
      const req = await Geolocation.requestPermissions({ permissions: ["location"] });
      if (req.location !== "granted" && req.coarseLocation !== "granted") {
        throw new GeoError(
          "denied",
          "Izin lokasi ditolak.",
          "Buka Pengaturan aplikasi → Izin → Lokasi, lalu aktifkan untuk MCM Storage.",
        );
      }
    }
  } catch (e) {
    if (e instanceof GeoError) throw e;
    // fall through to coords attempt
  }
  try {
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/denied|permission/i.test(msg)) {
      throw new GeoError("denied", "Izin lokasi ditolak.", "Buka Pengaturan aplikasi → Izin → Lokasi.");
    }
    if (/timeout/i.test(msg)) {
      throw new GeoError("timeout", "GPS tidak merespons.", "Pastikan layanan lokasi (GPS) ponsel menyala dan Anda berada di luar ruangan.");
    }
    throw new GeoError("unavailable", "Lokasi tidak tersedia.", "Aktifkan layanan lokasi pada ponsel lalu coba lagi.");
  }
}

async function getWeb(): Promise<GeoResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new GeoError("unsupported", "Peramban tidak mendukung GPS.");
  }
  if (!isSecure()) {
    throw new GeoError(
      "insecure",
      "GPS hanya tersedia di koneksi aman (HTTPS).",
      "Buka aplikasi melalui HTTPS atau localhost.",
    );
  }

  // Pre-check permission supaya bisa beri pesan ramah tanpa memicu prompt yang langsung gagal.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perms = (navigator as any).permissions;
    if (perms?.query) {
      const status = await perms.query({ name: "geolocation" as PermissionName });
      if (status.state === "denied") {
        throw new GeoError(
          "denied",
          "Izin lokasi diblokir untuk situs ini.",
          "Ketuk ikon gembok/info di kiri address bar → Izin situs → Lokasi → Izinkan, lalu muat ulang halaman.",
        );
      }
    }
  } catch (e) {
    if (e instanceof GeoError) throw e;
    // ignore — lanjut minta posisi
  }

  return await new Promise<GeoResult>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new GeoError(
            "denied",
            "Izin lokasi ditolak.",
            "Ketuk ikon gembok di address bar → Izin situs → Lokasi → Izinkan, lalu coba lagi.",
          ));
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          reject(new GeoError("unavailable", "Sinyal GPS tidak tersedia.", "Aktifkan layanan lokasi ponsel dan coba di area terbuka."));
        } else if (err.code === err.TIMEOUT) {
          reject(new GeoError("timeout", "GPS tidak merespons.", "Pastikan layanan lokasi menyala dan coba kembali."));
        } else {
          reject(new GeoError("unknown", err.message || "Gagal mengambil lokasi."));
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export async function getCurrentLocation(): Promise<GeoResult> {
  if (Capacitor.isNativePlatform()) return getNative();
  return getWeb();
}
