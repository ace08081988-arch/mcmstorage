/**
 * Pelacak sesi perangkat untuk fitur "Sesi & Perangkat":
 * - registerDeviceSession()  : upsert baris untuk perangkat ini saat user login.
 * - heartbeatDeviceSession() : update `last_seen_at` berkala (5 menit) +
 *                              periksa `revoked_at`. Jika sudah dicabut dari
 *                              perangkat lain, lakukan signOut otomatis.
 * - useDeviceSessionGuard()  : hook untuk dipasang di __root supaya seluruh
 *                              app ikut alur ini begitu user signed in.
 *
 * Device id disimpan di localStorage; bukan identitas keamanan, hanya label
 * agar operator bisa mengenali perangkat mana yang ia cabut. Pencabutan nyata
 * dilakukan via signOut lokal saat heartbeat melihat `revoked_at`.
 */
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const DEVICE_ID_KEY = "device-session:device-id:v1";
const HEARTBEAT_MS = 5 * 60 * 1000; // 5 menit
const REVOCATION_POLL_MS = 60 * 1000; // 1 menit

export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id =
      (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return `dev-${Date.now()}`;
  }
}

function describeDevice(): { label: string; userAgent: string; platform: string } {
  if (typeof navigator === "undefined") {
    return { label: "Perangkat", userAgent: "", platform: "" };
  }
  const ua = navigator.userAgent || "";
  const platform = (navigator as { platform?: string }).platform || "";
  let os = "Perangkat";
  if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";
  return { label: `${browser} di ${os}`, userAgent: ua, platform };
}

export async function registerDeviceSession(userId: string): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  const info = describeDevice();
  // Upsert: kalau perangkat ini pernah login, perbarui `last_seen_at` +
  // hapus `revoked_at` (user memang login lagi secara sah).
  await supabase
    .from("device_sessions")
    .upsert(
      {
        user_id: userId,
        device_id: deviceId,
        label: info.label,
        user_agent: info.userAgent,
        platform: info.platform,
        last_seen_at: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: "user_id,device_id" },
    );
}

async function heartbeatOnce(userId: string): Promise<"ok" | "revoked"> {
  const deviceId = getOrCreateDeviceId();
  // Periksa status sesi perangkat ini DULU. Kalau sudah dicabut dari tempat
  // lain, jangan menulis `last_seen_at` baru — supaya tidak mengaburkan jejak
  // pencabutan.
  const { data } = await supabase
    .from("device_sessions")
    .select("revoked_at")
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .maybeSingle();
  if (data?.revoked_at) return "revoked";
  await supabase
    .from("device_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("device_id", deviceId);
  return "ok";
}

/**
 * Hook untuk dipasang sekali di __root. Begitu user login: daftarkan
 * perangkat → mulai heartbeat + polling pencabutan. Saat sesi dicabut dari
 * tempat lain, hook ini memanggil signOut otomatis.
 */
export function useDeviceSessionGuard() {
  useEffect(() => {
    let cancelled = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let revokeTimer: ReturnType<typeof setInterval> | null = null;
    let activeUserId: string | null = null;

    const stopTimers = () => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (revokeTimer) { clearInterval(revokeTimer); revokeTimer = null; }
    };

    const checkRevocation = async () => {
      if (!activeUserId || cancelled) return;
      try {
        const status = await heartbeatOnce(activeUserId);
        if (status === "revoked" && !cancelled) {
          stopTimers();
          await supabase.auth.signOut();
          if (typeof window !== "undefined") {
            window.location.replace("/auth?revoked=1");
          }
        }
      } catch { /* offline / transient */ }
    };

    const start = async (userId: string) => {
      activeUserId = userId;
      try { await registerDeviceSession(userId); } catch { /* ignore */ }
      stopTimers();
      heartbeatTimer = setInterval(() => { void checkRevocation(); }, HEARTBEAT_MS);
      revokeTimer = setInterval(() => { void checkRevocation(); }, REVOCATION_POLL_MS);
      // Periksa segera setelah register supaya cabut yang terjadi saat tab
      // offline langsung dieksekusi begitu kembali online.
      void checkRevocation();
    };

    // Inisialisasi: user mungkin sudah login saat hook mount.
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (data.user) void start(data.user.id);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        void start(session.user.id);
      } else if (event === "SIGNED_OUT") {
        activeUserId = null;
        stopTimers();
      }
    });

    const onFocus = () => { void checkRevocation(); };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }

    return () => {
      cancelled = true;
      stopTimers();
      sub.subscription.unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, []);
}

export const DEVICE_SESSION_INTERNALS = { DEVICE_ID_KEY };