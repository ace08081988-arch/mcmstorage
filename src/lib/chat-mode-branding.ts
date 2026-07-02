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
 * No-op di mode "full".
 */
export function applyChatModeBranding() {
  if (typeof document === "undefined") return;
  if (!isChatOnly()) return;

  document.title = "MCM Chat";

  const setMeta = (name: string, content: string) => {
    let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.name = name;
      document.head.appendChild(el);
    }
    el.content = content;
  };
  setMeta("apple-mobile-web-app-title", "MCM Chat");
  setMeta("application-name", "MCM Chat");
  setMeta("theme-color", "#064e3b");

  const setLink = (
    selector: string,
    attrs: Record<string, string>,
  ) => {
    const el = document.querySelector<HTMLLinkElement>(selector);
    if (!el) return;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  };
  setLink('link[rel="manifest"]', { href: "/manifest-chat.webmanifest" });
  setLink('link[rel="apple-touch-icon"]', { href: "/mcm-chat-icon.png" });
  // Icon utama (browser tab / PWA)
  document
    .querySelectorAll<HTMLLinkElement>('link[rel="icon"]')
    .forEach((el) => el.setAttribute("href", "/mcm-chat-icon.png"));
  const shortcut = document.querySelector<HTMLLinkElement>(
    'link[rel="shortcut icon"]',
  );
  if (shortcut) shortcut.href = "/mcm-chat-icon.png";
}