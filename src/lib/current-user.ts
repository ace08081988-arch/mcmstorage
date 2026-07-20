/**
 * Cache in-memory ringan untuk identitas user aktif.
 *
 * Latar: banyak komponen (sidebar, header, bell, hooks, guards) memanggil
 * `supabase.auth.getUser()` di useEffect masing-masing. Setiap panggilan
 * memicu round-trip HTTP ke `/auth/v1/user` — dalam satu navigasi bisa
 * terjadi 6-10× dan menyebabkan aplikasi terasa berat + kadang "seperti
 * relog" saat network lambat (semua hook menunggu balasan yang sama).
 *
 * Solusi:
 *  - Panggilan pertama memicu `getUser()` sungguhan → di-cache di modul.
 *  - Panggilan berikutnya dari komponen manapun mendapat Promise yang sama
 *    (dedup in-flight) lalu hasil ter-cache.
 *  - Cache di-invalidate otomatis oleh `onAuthStateChange` (login, logout,
 *    token refresh dengan user id baru).
 *  - Untuk hot path yang butuh instan (render initial), tersedia
 *    `peekCachedUserId()` yang membaca session lokal (non-network) dan
 *    `useCurrentUserId()` hook.
 */
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type CachedUser = User | null;

let cached: CachedUser | undefined;
let inflight: Promise<CachedUser> | null = null;
let listenersInstalled = false;
const subscribers = new Set<(u: CachedUser) => void>();

function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || event === "USER_DELETED") {
      cached = null;
      inflight = null;
      subscribers.forEach((fn) => fn(null));
      return;
    }
    if (session?.user) {
      cached = session.user;
      inflight = null;
      subscribers.forEach((fn) => fn(session.user));
    }
  });
}

/**
 * Ambil user aktif dengan dedup. Sama-sama memvalidasi ke server pada
 * panggilan pertama; panggilan berikut dari komponen manapun memakai cache.
 */
export async function getCurrentUser(): Promise<CachedUser> {
  installListeners();
  if (cached !== undefined) return cached;
  if (inflight) return inflight;
  inflight = supabase.auth
    .getUser()
    .then(({ data }) => {
      cached = data.user ?? null;
      subscribers.forEach((fn) => fn(cached));
      return cached;
    })
    .catch(() => {
      inflight = null;
      return null;
    });
  return inflight;
}

export async function getCurrentUserId(): Promise<string | null> {
  const u = await getCurrentUser();
  return u?.id ?? null;
}

/**
 * Baca id user secara sinkron dari sesi lokal (localStorage) — tanpa
 * network. Cocok untuk hydrate awal komponen agar tidak flicker.
 */
export function peekCachedUserId(): string | null {
  if (cached !== undefined) return cached?.id ?? null;
  return null;
}

/** Hook praktis: `{ userId, ready }`. */
export function useCurrentUserId(): { userId: string | null; ready: boolean } {
  const [userId, setUserId] = useState<string | null>(() => peekCachedUserId());
  const [ready, setReady] = useState<boolean>(() => cached !== undefined);

  useEffect(() => {
    let cancelled = false;
    const onChange = (u: CachedUser) => {
      if (cancelled) return;
      setUserId(u?.id ?? null);
      setReady(true);
    };
    subscribers.add(onChange);
    void getCurrentUser().then((u) => {
      if (cancelled) return;
      setUserId(u?.id ?? null);
      setReady(true);
    });
    return () => {
      cancelled = true;
      subscribers.delete(onChange);
    };
  }, []);

  return { userId, ready };
}