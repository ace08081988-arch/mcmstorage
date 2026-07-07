/**
 * Dev bypass Turnstile.
 *
 * Saat berjalan di localhost dalam mode dev (`import.meta.env.DEV`), CAPTCHA
 * bisa dilewati agar iterasi cepat tidak terganggu widget Cloudflare. Server
 * (`secureSignUp`) hanya menerima bypass jika request datang dari IP loopback
 * dan `NODE_ENV !== "production"`, sehingga token ajaib ini tidak berlaku di
 * preview/publish.
 */

export const DEV_TURNSTILE_TOKEN = "dev-bypass";

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
]);

export function isTurnstileDevBypass(): boolean {
  if (typeof window === "undefined") return false;
  if (!import.meta.env.DEV) return false;
  const host = window.location.hostname;
  return LOCAL_HOSTS.has(host);
}

export const LOCAL_IPS = new Set([
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "::ffff:127.0.0.1",
]);