/**
 * Konfigurasi scroll-guard sidebar yang bisa disesuaikan per-device.
 *
 * - `cooldownMs`     — durasi window "scroll baru saja aktif" (default 250ms).
 *                      Perangkat dengan inertial scroll panjang boleh naik ke 350–500ms.
 * - `driftPx`        — ambang pergerakan pointer maks. yang masih dianggap tap (default 10px).
 *                      Layar sensitif / jari besar boleh naik ke 14–16px.
 * - `longPressMs`    — batas atas durasi tap sebelum dianggap tekan-lama (default 600ms).
 *
 * Nilai dibaca sekali per proses lalu di-cache; getter membaca localStorage
 * pertama kali dan mendengarkan `storage` + custom event agar tab lain juga
 * ikut update.
 */

export type ScrollGuardConfig = {
  cooldownMs: number;
  driftPx: number;
  longPressMs: number;
  hintScrollText: string;
  hintDriftText: string;
  hintFadeMs: number;
  hintHoldMs: number;
};

export const DEFAULT_SCROLL_GUARD: ScrollGuardConfig = {
  cooldownMs: 250,
  driftPx: 10,
  longPressMs: 600,
  hintScrollText: "Tunggu scroll selesai…",
  hintDriftText: "Geser terdeteksi — tap dibatalkan",
  hintFadeMs: 140,
  hintHoldMs: 1200,
};

export const SCROLL_GUARD_BOUNDS = {
  cooldownMs: { min: 100, max: 800, step: 25 },
  driftPx: { min: 4, max: 24, step: 1 },
  longPressMs: { min: 300, max: 1500, step: 50 },
  hintFadeMs: { min: 0, max: 600, step: 20 },
  hintHoldMs: { min: 300, max: 4000, step: 100 },
  hintTextMaxLen: 80,
} as const;

const STORAGE_KEY = "mcm.scroll-guard.v2";
const CHANGE_EVENT = "mcm:scroll-guard-changed";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function sanitizeText(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, SCROLL_GUARD_BOUNDS.hintTextMaxLen);
}

function sanitize(raw: unknown): ScrollGuardConfig {
  const r = (raw ?? {}) as Partial<ScrollGuardConfig>;
  return {
    cooldownMs: clamp(
      Number.isFinite(r.cooldownMs) ? Number(r.cooldownMs) : DEFAULT_SCROLL_GUARD.cooldownMs,
      SCROLL_GUARD_BOUNDS.cooldownMs.min,
      SCROLL_GUARD_BOUNDS.cooldownMs.max,
    ),
    driftPx: clamp(
      Number.isFinite(r.driftPx) ? Number(r.driftPx) : DEFAULT_SCROLL_GUARD.driftPx,
      SCROLL_GUARD_BOUNDS.driftPx.min,
      SCROLL_GUARD_BOUNDS.driftPx.max,
    ),
    longPressMs: clamp(
      Number.isFinite(r.longPressMs) ? Number(r.longPressMs) : DEFAULT_SCROLL_GUARD.longPressMs,
      SCROLL_GUARD_BOUNDS.longPressMs.min,
      SCROLL_GUARD_BOUNDS.longPressMs.max,
    ),
    hintScrollText: sanitizeText(r.hintScrollText, DEFAULT_SCROLL_GUARD.hintScrollText),
    hintDriftText: sanitizeText(r.hintDriftText, DEFAULT_SCROLL_GUARD.hintDriftText),
    hintFadeMs: clamp(
      Number.isFinite(r.hintFadeMs) ? Number(r.hintFadeMs) : DEFAULT_SCROLL_GUARD.hintFadeMs,
      SCROLL_GUARD_BOUNDS.hintFadeMs.min,
      SCROLL_GUARD_BOUNDS.hintFadeMs.max,
    ),
    hintHoldMs: clamp(
      Number.isFinite(r.hintHoldMs) ? Number(r.hintHoldMs) : DEFAULT_SCROLL_GUARD.hintHoldMs,
      SCROLL_GUARD_BOUNDS.hintHoldMs.min,
      SCROLL_GUARD_BOUNDS.hintHoldMs.max,
    ),
  };
}

let cached: ScrollGuardConfig | null = null;

function loadFromStorage(): ScrollGuardConfig {
  if (typeof window === "undefined") return DEFAULT_SCROLL_GUARD;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SCROLL_GUARD;
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_SCROLL_GUARD;
  }
}

if (typeof window !== "undefined" && !(window as any).__scrollGuardCfgBind) {
  (window as any).__scrollGuardCfgBind = true;
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) cached = null;
  });
  window.addEventListener(CHANGE_EVENT, () => {
    cached = null;
  });
}

/** Baca konfigurasi terkini (cache di-invalidate saat diubah). */
export function getScrollGuardConfig(): ScrollGuardConfig {
  if (!cached) cached = loadFromStorage();
  return cached;
}

/** Simpan konfigurasi baru. Broadcast ke tab lain dan komponen dalam-tab. */
export function setScrollGuardConfig(next: Partial<ScrollGuardConfig>): ScrollGuardConfig {
  const merged = sanitize({ ...getScrollGuardConfig(), ...next });
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // ignore quota errors
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
  cached = merged;
  // Fire-and-forget: sinkron ke Lovable Cloud agar bertahan lintas perangkat.
  void syncToCloud(merged);
  return merged;
}

/** Kembalikan ke default pabrik. */
export function resetScrollGuardConfig(): ScrollGuardConfig {
  return setScrollGuardConfig(DEFAULT_SCROLL_GUARD);
}

/** Subscribe perubahan (in-tab + cross-tab). Return unsubscribe. */
export function subscribeScrollGuard(cb: (cfg: ScrollGuardConfig) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb(getScrollGuardConfig());
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Sinkronisasi ke Lovable Cloud (tabel public.scroll_guard_config)
// ---------------------------------------------------------------------------
// Alur:
//   1) Saat modul dimuat / user login → hidrasi cache dari server (kalau ada
//      baris untuk user), timpa localStorage, broadcast CHANGE_EVENT.
//   2) Saat setScrollGuardConfig dipanggil → upsert baris user (fire-and-forget).
//   3) Saat user logout / berganti akun → reload dari server berikutnya.
// Anonymous user (belum login) tetap pakai localStorage saja.

let hydratedForUser: string | null = null;
let hydrating: Promise<void> | null = null;

async function hydrateFromCloud(userId: string): Promise<void> {
  if (hydratedForUser === userId) return;
  try {
    const { data, error } = await supabase
      .from("scroll_guard_config")
      .select("config")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return;
    hydratedForUser = userId;
    if (!data) return;
    const merged = sanitize(data.config);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {
        // ignore
      }
      cached = merged;
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    }
  } catch {
    // offline / RLS → localStorage tetap jadi sumber kebenaran lokal
  }
}

async function syncToCloud(cfg: ScrollGuardConfig): Promise<void> {
  try {
    const { data: sess } = await supabase.auth.getUser();
    const userId = sess?.user?.id;
    if (!userId) return;
    await supabase
      .from("scroll_guard_config")
      .upsert(
        { user_id: userId, config: cfg, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    hydratedForUser = userId;
  } catch {
    // best-effort: gagal jaringan tidak mempengaruhi UI
  }
}

/** Paksa muat ulang dari server untuk user aktif. Aman dipanggil berulang. */
export function ensureScrollGuardHydrated(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (hydrating) return hydrating;
  hydrating = (async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const uid = data?.user?.id;
      if (uid) await hydrateFromCloud(uid);
    } finally {
      hydrating = null;
    }
  })();
  return hydrating;
}

if (typeof window !== "undefined" && !(window as any).__scrollGuardCloudBind) {
  (window as any).__scrollGuardCloudBind = true;
  // Hidrasi pertama (non-blocking).
  void ensureScrollGuardHydrated();
  // Re-hidrasi setiap kali sesi berubah (login/logout/refresh).
  supabase.auth.onAuthStateChange((_evt, session) => {
    if (!session?.user) {
      hydratedForUser = null;
      return;
    }
    if (hydratedForUser !== session.user.id) {
      hydratedForUser = null;
      void hydrateFromCloud(session.user.id);
    }
  });
}

/** Hook React: konfigurasi hidup + setter praktis. */
export function useScrollGuardConfig() {
  const [cfg, setCfg] = useState<ScrollGuardConfig>(() => getScrollGuardConfig());
  useEffect(() => {
    // Pastikan cache sinkron dengan server saat komponen mount (mis. sehabis reload).
    void ensureScrollGuardHydrated();
    return subscribeScrollGuard(setCfg);
  }, []);
  return {
    cfg,
    set: (patch: Partial<ScrollGuardConfig>) => setCfg(setScrollGuardConfig(patch)),
    reset: () => setCfg(resetScrollGuardConfig()),
  };
}