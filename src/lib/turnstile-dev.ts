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

/**
 * Predikat server-side untuk menentukan apakah request boleh melewati
 * verifikasi Turnstile. Bypass HANYA lolos jika ketiga syarat berikut
 * terpenuhi:
 *   1. IP klien termasuk loopback (localhost)
 *   2. NODE_ENV bukan "production"
 *   3. Token yang dikirim tepat sama dengan DEV_TURNSTILE_TOKEN
 *
 * Fungsi pure — mudah di-unit-test tanpa mock request/network.
 */
export function shouldAllowTurnstileDevBypass(
  ip: string | null | undefined,
  nodeEnv: string | null | undefined,
  token: string | null | undefined,
): boolean {
  if (!ip || !nodeEnv || !token) return false;
  if (!LOCAL_IPS.has(ip)) return false;
  if (nodeEnv === "production") return false;
  if (token !== DEV_TURNSTILE_TOKEN) return false;
  return true;
}