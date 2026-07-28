/**
 * Sinkronisasi pengaturan tampilan ke akun (Lovable Cloud) supaya preset
 * ikut berpindah antar perangkat.
 *
 * Sumber kebenaran saat boot tetap localStorage (tanpa menunggu jaringan).
 * Tabel `user_appearance_prefs` menyimpan payload ekspor terakhir milik user
 * + `updated_at`, lalu dipulihkan di perangkat lain saat lebih baru dari
 * sinkron terakhir perangkat itu.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  LS,
  DEFAULT_FX,
  writeSurfaceFx,
  applyAppearance,
  type SurfaceFx,
} from "@/components/appearance-init";
import { setAppPrefs } from "@/lib/app-prefs";

const COMPACT_LS = "app-compact-mode";
const LAST_SYNC_LS = "app-appearance-cloud-sync";

export type AppearanceCloudPayload = Record<string, unknown>;

export type CloudAppearance = {
  payload: AppearanceCloudPayload;
  updatedAt: string;
};

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Terapkan payload cloud ke localStorage + DOM perangkat ini. */
export function applyCloudPayload(payload: AppearanceCloudPayload) {
  if (typeof window === "undefined") return;
  const a = (payload.appearance ?? {}) as Record<string, unknown>;
  if (typeof a.theme === "string") localStorage.setItem(LS.theme, a.theme);
  if (typeof a.font === "string") localStorage.setItem(LS.font, a.font);
  if (typeof a.size === "string") localStorage.setItem(LS.size, a.size);
  if (typeof a.accent === "string") localStorage.setItem(LS.accent, a.accent);
  if (a.radius != null) localStorage.setItem(LS.radius, String(num(a.radius, 0.625)));
  if (typeof a.bgImage === "string") {
    if (a.bgImage) localStorage.setItem(LS.bgImage, a.bgImage);
    else localStorage.removeItem(LS.bgImage);
  }
  if (a.bgOverlay != null) localStorage.setItem(LS.bgOverlay, String(num(a.bgOverlay, 0.7)));
  if (a.bgBlur != null) localStorage.setItem(LS.bgBlur, String(num(a.bgBlur, 0)));

  const fx = payload.fx as Partial<SurfaceFx> | undefined;
  if (fx && typeof fx === "object") writeSurfaceFx({ ...DEFAULT_FX, ...fx });

  if (typeof payload.compact === "boolean") {
    localStorage.setItem(COMPACT_LS, payload.compact ? "1" : "0");
    document.documentElement.classList.toggle("compact", payload.compact);
  }

  const p = (payload.appPrefs ?? {}) as Record<string, unknown>;
  setAppPrefs({
    fontScale: num(p.fontScale, 1),
    highContrast: p.highContrast === true,
    reduceMotion: p.reduceMotion === true,
  });

  applyAppearance();
}

function markSynced(updatedAt: string) {
  try {
    localStorage.setItem(LAST_SYNC_LS, updatedAt);
  } catch {
    /* ignore quota */
  }
}

function lastSyncedAt(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_LS);
  } catch {
    return null;
  }
}

/** Simpan payload tampilan ke akun. Melempar error agar pemanggil bisa toast. */
export async function pushAppearanceToCloud(
  payload: AppearanceCloudPayload,
): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Belum masuk ke akun.");
  const { data, error } = await supabase
    .from("user_appearance_prefs")
    .upsert(
      {
        user_id: userId,
        payload: payload as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("updated_at")
    .single();
  if (error) throw error;
  const updatedAt = data?.updated_at ?? new Date().toISOString();
  markSynced(updatedAt);
  return updatedAt;
}

/** Ambil payload tampilan milik akun ini (null bila belum pernah disimpan). */
export async function fetchAppearanceFromCloud(): Promise<CloudAppearance | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("user_appearance_prefs")
    .select("payload, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    payload: (data.payload ?? {}) as AppearanceCloudPayload,
    updatedAt: data.updated_at,
  };
}

/** Tarik & terapkan pengaturan dari akun (dipakai tombol manual). */
export async function pullAppearanceFromCloud(): Promise<CloudAppearance | null> {
  const cloud = await fetchAppearanceFromCloud();
  if (!cloud) return null;
  applyCloudPayload(cloud.payload);
  markSynced(cloud.updatedAt);
  return cloud;
}

/**
 * Hidrasi otomatis saat aplikasi dibuka: hanya menerapkan bila versi cloud
 * lebih baru dari sinkron terakhir perangkat ini, sehingga perubahan lokal
 * yang belum diunggah tidak tertimpa berulang.
 */
export async function hydrateAppearanceFromCloud(): Promise<boolean> {
  try {
    const cloud = await fetchAppearanceFromCloud();
    if (!cloud) return false;
    const last = lastSyncedAt();
    if (last && new Date(cloud.updatedAt).getTime() <= new Date(last).getTime()) {
      return false;
    }
    applyCloudPayload(cloud.payload);
    markSynced(cloud.updatedAt);
    return true;
  } catch {
    return false;
  }
}
