import { isLockSuppressed } from "@/lib/app-lock";

// Deep link handler untuk APK Android (Capacitor).
//
// Mendukung dua bentuk URL yang dikirim OS ke aplikasi:
//   1) Custom scheme  : biz.mcmstorage.app://t/<share_token>?p=<pin>
//   2) Android App Link: https://mcmstorage.biz/t/<share_token>?p=<pin>
//      (atau menggunakan fragment #p=<pin>)
//
// Tujuannya: begitu OS memicu URL, aplikasi langsung menuju
// /t/<share_token>#p=<pin> — route worker portal sudah menangani
// pengisian PIN otomatis dari fragment tersebut.

type DeepLinkRouter = {
  navigate: (opts: { to: string; hash?: string }) => unknown;
};

function extractPin(u: URL): string | null {
  // Prioritas 1: query ?p=1234 (mudah diteruskan lewat scanner/OS).
  const q = u.searchParams.get("p");
  if (q && /^\d{4,8}$/.test(q)) return q;
  // Prioritas 2: fragment #p=1234 — format share URL /t/... existing.
  const hash = u.hash.replace(/^#/, "");
  const m = hash.match(/(?:^|&)p=(\d{4,8})/);
  return m ? m[1] : null;
}

function extractToken(u: URL): string | null {
  // biz.mcmstorage.app://t/<token>  → host="t", path="/<token>"
  // https://mcmstorage.biz/t/<token> → path="/t/<token>"
  const parts = u.pathname.split("/").filter(Boolean);
  if (u.protocol === "biz.mcmstorage.app:" || u.host === "t") {
    // host bisa "t" (custom scheme) ATAU path segment pertama = "t"
    if (u.host === "t") return parts[0] ?? null;
    if (parts[0] === "t") return parts[1] ?? null;
    return parts[0] ?? null;
  }
  const idx = parts.indexOf("t");
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

export function parseDeepLink(rawUrl: string): { token: string; pin: string | null } | null {
  try {
    const u = new URL(rawUrl);
    const token = extractToken(u);
    if (!token) return null;
    return { token, pin: extractPin(u) };
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deep link chat dari notifikasi native / bubble Android.
 *
 *   biz.mcmstorage.app://chat/<conversationId>[?call=<callId>]
 *   https://mcmstorage.app/chat/<conversationId>
 *
 * Dipisah dari `parseDeepLink` (portal pegawai /t/<token>) supaya kedua
 * bentuk tidak saling menebak: token portal bebas, id percakapan UUID.
 */
export function parseChatDeepLink(
  rawUrl: string,
): { conversationId: string; callId: string | null } | null {
  try {
    const u = new URL(rawUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    let id: string | null = null;
    if (u.host === "chat") id = parts[0] ?? null;
    else {
      const idx = parts.indexOf("chat");
      if (idx >= 0) id = parts[idx + 1] ?? null;
    }
    if (!id || !UUID_RE.test(id)) return null;
    const call = u.searchParams.get("call");
    return { conversationId: id, callId: call && UUID_RE.test(call) ? call : null };
  } catch {
    return null;
  }
}

export function shouldSkipDeepLinkNavigation(
  current: Pick<Location, "pathname" | "search" | "hash">,
  targetPath: string,
  targetHash: string,
  nativePickerSuppressed: boolean,
): boolean {
  const currentFull = `${current.pathname}${current.search}${current.hash}`;
  const targetFull = `${targetPath}${targetHash ? `#${targetHash}` : ""}`;

  // Exact no-op: jangan paksa router menavigasi ke URL yang sama.
  if (currentFull === targetFull) return true;

  // Android sering mengirim ulang intent terakhir saat kembali dari Photo
  // Picker/Galeri. Kalau portal sudah berada di task yang sama dan guard
  // native picker masih aktif, intent itu adalah echo lama — bukan navigasi
  // baru. Mengabaikannya mencegah route remount yang menutup form request.
  if (nativePickerSuppressed && current.pathname === targetPath) return true;

  return false;
}

export async function startDeepLinkListener(router: DeepLinkRouter) {
  if (typeof window === "undefined") return;
  let App: typeof import("@capacitor/app").App | null = null;
  try {
    const mod = await import("@capacitor/app");
    App = mod.App;
  } catch {
    return; // web/PWA — deep link native tidak berlaku
  }
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return;

  const handle = (rawUrl: string) => {
    // Chat dulu — notifikasi/bubble Android memakai bentuk /chat/<uuid>.
    const chat = parseChatDeepLink(rawUrl);
    if (chat) {
      const path = `/chat/${chat.conversationId}`;
      if (window.location.pathname === path && !chat.callId) return;
      try {
        router.navigate({ to: path });
      } catch {
        window.location.assign(path);
      }
      if (chat.callId) {
        const callId = chat.callId;
        void import("@/components/chat/CallHost").then(({ dispatchAnswerCall }) => {
          dispatchAnswerCall(callId);
        });
      }
      return;
    }
    const parsed = parseDeepLink(rawUrl);
    if (!parsed) return;
    const path = `/t/${encodeURIComponent(parsed.token)}`;
    const hash = parsed.pin ? `p=${parsed.pin}` : "";
    if (shouldSkipDeepLinkNavigation(window.location, path, hash, isLockSuppressed())) return;
    try {
      router.navigate({ to: path, hash: hash || undefined });
    } catch {
      window.location.assign(`${path}${hash ? `#${hash}` : ""}`);
    }
  };

  // URL saat app di-cold start dari intent
  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) handle(launch.url);
  } catch { /* ignore */ }

  // URL saat app sudah berjalan lalu menerima intent baru
  App.addListener("appUrlOpen", (evt) => {
    if (evt?.url) handle(evt.url);
  });
}