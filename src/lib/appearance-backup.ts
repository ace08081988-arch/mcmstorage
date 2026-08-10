/**
 * Validasi + cadangan otomatis preset tampilan sebelum menimpa data akun.
 *
 * Alur "Simpan ke akun":
 *   1. `validateAppearancePayload` menolak payload rusak/tidak lengkap.
 *   2. Versi akun yang lama diunduh dan disimpan sebagai cadangan lokal
 *      (maks. 5 versi, ter-scope per user) SEBELUM upsert dijalankan.
 *   3. Cadangan bisa dipulihkan lagi kapan saja dari halaman pengaturan.
 *
 * Cadangan sengaja disimpan lokal: isinya hanya preferensi tampilan,
 * tidak perlu tabel baru, dan tetap terpakai di perangkat yang menimpa.
 */
import { peekUserIdSync, scopedKey } from "@/lib/user-scoped-storage";
import type { AppearanceCloudPayload } from "@/lib/appearance-cloud";

const BACKUP_BASE = "mcm:appearance:cloudBackups";
export const MAX_APPEARANCE_BACKUPS = 5;

export type AppearanceBackup = {
  id: string;
  /** Kapan cadangan dibuat (ISO). */
  createdAt: string;
  /** `updated_at` versi akun yang dicadangkan (ISO), bila diketahui. */
  cloudUpdatedAt: string | null;
  payload: AppearanceCloudPayload;
};

export type AppearanceValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

const THEMES = new Set(["light", "dark", "system"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function numOk(v: unknown, min: number, max: number): boolean {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max;
}

/**
 * Periksa payload sebelum diunggah. `errors` memblokir simpan;
 * `warnings` hanya diinformasikan (nilai tak dikenal tetap aman diabaikan
 * oleh `applyCloudPayload`).
 */
export function validateAppearancePayload(
  payload: unknown,
): AppearanceValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(payload)) {
    return { ok: false, errors: ["Data pengaturan tidak terbaca."], warnings };
  }

  const appearance = payload.appearance;
  if (!isRecord(appearance)) {
    errors.push("Bagian tampilan (tema, font, aksen) kosong.");
  } else {
    if (typeof appearance.theme !== "string" || !appearance.theme) {
      errors.push("Tema belum terisi.");
    } else if (!THEMES.has(appearance.theme)) {
      warnings.push(`Tema "${appearance.theme}" tidak dikenal versi ini.`);
    }
    if (typeof appearance.accent !== "string" || !appearance.accent) {
      errors.push("Warna aksen belum terisi.");
    }
    if (typeof appearance.font !== "string" || !appearance.font) {
      errors.push("Jenis huruf belum terisi.");
    }
    if (!numOk(appearance.radius, 0, 3)) {
      errors.push("Nilai kelengkungan sudut di luar batas wajar (0–3).");
    }
    if (!numOk(appearance.bgOverlay, 0, 1)) {
      errors.push("Transparansi latar harus antara 0 dan 1.");
    }
    if (!numOk(appearance.bgBlur, 0, 60)) {
      errors.push("Nilai blur latar di luar batas wajar (0–60).");
    }
    if (typeof appearance.bgImage === "string" && appearance.bgImage.length > 2_000_000) {
      errors.push("Gambar latar terlalu besar untuk disimpan ke akun.");
    }
  }

  const prefs = payload.appPrefs;
  if (isRecord(prefs) && !numOk(prefs.fontScale, 0.5, 2)) {
    errors.push("Skala huruf harus antara 0,5 dan 2.");
  }

  if (payload.fx != null && !isRecord(payload.fx)) {
    warnings.push("Efek permukaan dilewati karena formatnya tidak sesuai.");
  }

  return { ok: errors.length === 0, errors, warnings };
}

function key(): string {
  return scopedKey(BACKUP_BASE, peekUserIdSync());
}

/** Daftar cadangan, terbaru di atas. */
export function listAppearanceBackups(): AppearanceBackup[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key());
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (b): b is AppearanceBackup =>
        isRecord(b) && typeof b.id === "string" && isRecord(b.payload),
    );
  } catch {
    return [];
  }
}

function writeBackups(list: AppearanceBackup[]) {
  try {
    localStorage.setItem(
      key(),
      JSON.stringify(list.slice(0, MAX_APPEARANCE_BACKUPS)),
    );
  } catch {
    /* kuota penuh — cadangan bersifat best-effort */
  }
}

/** Simpan satu versi akun sebagai cadangan lokal (dedup by cloudUpdatedAt). */
export function saveAppearanceBackup(
  payload: AppearanceCloudPayload,
  cloudUpdatedAt: string | null,
): AppearanceBackup | null {
  if (typeof window === "undefined") return null;
  const existing = listAppearanceBackups();
  if (
    cloudUpdatedAt &&
    existing.some((b) => b.cloudUpdatedAt === cloudUpdatedAt)
  ) {
    return null;
  }
  const backup: AppearanceBackup = {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `bk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    cloudUpdatedAt,
    payload,
  };
  writeBackups([backup, ...existing]);
  return backup;
}

export function deleteAppearanceBackup(id: string) {
  writeBackups(listAppearanceBackups().filter((b) => b.id !== id));
}

export function clearAppearanceBackups() {
  writeBackups([]);
}