import { isChatOnly } from "@/lib/app-mode";

/**
 * Terapkan branding MCM Chat secara runtime saat mode chat aktif:
 * - Ganti judul dokumen + apple-mobile-web-app-title.
 * - Ganti favicon & apple-touch-icon ke ikon khusus MCM Chat.
 * - Ganti target manifest ke `manifest-chat.webmanifest` supaya
 *   PWA/Add-to-Home-Screen menampilkan nama & ikon MCM Chat.
 * - Warna theme + status bar tetap emerald tapi lebih gelap agar
 *   terasa terpisah dari MCM Storage.
 *
 * Ketika pindah balik ke mode "full", branding di-restore ke default
 * MCM Storage (bukan no-op). Selain itu:
 * - `<link rel="manifest">` node-nya di-*replace* (bukan cuma diubah
 *   `href`-nya) supaya browser benar-benar re-parse manifest, dan
 *   query-string cache-buster ditambahkan agar WebView / HTTP cache /
 *   service worker tidak menyajikan versi lama.
 * - Service worker `sw-push.js` diberi `INVALIDATE_ASSETS` postMessage
 *   agar entri manifest & ikon di cache di-drop sebelum halaman
 *   meminta ulang.
 */

type BrandingProfile = {
  title: string;
  themeColor: string;
  manifest: string;
  appleIcon: string;
  favicon: string;
};

const CHAT_PROFILE: BrandingProfile = {
  title: "MCM Chat",
  themeColor: "#064e3b",
  manifest: "/manifest-chat.webmanifest",
  appleIcon: "/mcm-chat-icon.png",
  favicon: "/mcm-chat-icon.png",
};

const FULL_PROFILE: BrandingProfile = {
  title: "MCM Storage",
  themeColor: "#0f172a",
  manifest: "/manifest.webmanifest",
  appleIcon: "/apple-touch-icon.png",
  favicon: "/favicon.ico",
};

/**
 * Aset yang harus di-invalidate di service worker cache setiap kali
 * mode berganti (agar network-first benar-benar mengambil versi baru).
 */
const ASSETS_TO_INVALIDATE = [
  "/manifest.webmanifest",
  "/manifest-chat.webmanifest",
  "/mcm-chat-icon.png",
  "/apple-touch-icon.png",
  "/favicon.ico",
];

let lastAppliedMode: "chat" | "full" | null = null;

function stripQuery(href: string): string {
  const q = href.indexOf("?");
  return q === -1 ? href : href.slice(0, q);
}

function withBust(path: string, bust: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}v=${bust}`;
}

function setMeta(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

/**
 * Ganti node `<link rel="manifest">` sepenuhnya (bukan cuma set href).
 * Beberapa browser hanya re-parse manifest ketika elemen link-nya
 * diganti, bukan ketika atribut `href`-nya diubah in-place.
 */
function replaceManifestLink(href: string) {
  const head = document.head;
  const existing = head.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]');
  existing.forEach((el) => el.remove());
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = href;
  head.appendChild(link);
}

function setIconLinks(href: string) {
  document
    .querySelectorAll<HTMLLinkElement>('link[rel="icon"]')
    .forEach((el) => el.setAttribute("href", href));
  const shortcut = document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]');
  if (shortcut) shortcut.href = href;
}

function invalidateSwAssets(paths: string[]) {
  try {
    if (typeof navigator === "undefined") return;
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const target = sw.controller;
    if (!target) return;
    target.postMessage({ type: "INVALIDATE_ASSETS", paths });
  } catch { /* ignore */ }
}

function applyProfile(profile: BrandingProfile, mode: "chat" | "full") {
  const bust = `${mode}-${Date.now()}`;
  document.title = profile.title;
  setMeta("apple-mobile-web-app-title", profile.title);
  setMeta("application-name", profile.title);
  setMeta("theme-color", profile.themeColor);

  // Manifest: replace node + append cache-buster.
  replaceManifestLink(withBust(stripQuery(profile.manifest), bust));

  // Apple touch icon (baseline, tanpa sizes).
  const apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (apple) apple.href = withBust(stripQuery(profile.appleIcon), bust);

  // Favicon utama.
  setIconLinks(withBust(stripQuery(profile.favicon), bust));

  invalidateSwAssets(ASSETS_TO_INVALIDATE);
}

export function applyChatModeBranding() {
  if (typeof document === "undefined") return;
  const mode: "chat" | "full" = isChatOnly() ? "chat" : "full";
  if (mode === lastAppliedMode) return;
  lastAppliedMode = mode;
  applyProfile(mode === "chat" ? CHAT_PROFILE : FULL_PROFILE, mode);
}