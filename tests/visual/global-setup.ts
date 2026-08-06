import { chromium, type FullConfig } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Setup login otomatis untuk seluruh spec E2E/visual yang butuh sesi.
 *
 * Hasil akhir selalu: `tests/visual/.auth/user.json` berisi storageState
 * dengan sesi Supabase aktif, sehingga spec tidak perlu self-skip.
 *
 * Strategi (dicoba berurutan, yang pertama berhasil dipakai):
 *   1. Sesi terinjeksi sandbox — LOVABLE_BROWSER_SUPABASE_SESSION_JSON
 *      (+ _STORAGE_KEY, opsional _COOKIES_JSON).
 *   2. Password grant langsung ke endpoint auth Supabase memakai
 *      TEST_EMAIL/TEST_PASSWORD → tulis token ke localStorage. Cepat &
 *      tidak bergantung pada UI /auth.
 *   3. Fallback login lewat UI /auth (kalau grant API diblokir).
 *
 * Env:
 *   TEST_EMAIL / TEST_PASSWORD   kredensial user uji
 *   BASE_URL                     default http://localhost:5173
 *   PWTEST_REQUIRE_AUTH=1        gagalkan setup bila sesi tidak didapat
 *                                (dipakai CI supaya tidak "hijau palsu")
 */
const STORAGE = "tests/visual/.auth/user.json";

function readEnvFile(): Record<string, string> {
  try {
    const raw = readFileSync(".env", "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  } catch {
    return {};
  }
}

function supabaseConfig(): { url: string; key: string; storageKey: string } | null {
  const file = readEnvFile();
  const url = process.env.VITE_SUPABASE_URL || file.VITE_SUPABASE_URL || "";
  const key =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    file.VITE_SUPABASE_PUBLISHABLE_KEY ||
    "";
  if (!url || !key) return null;
  const ref = url.match(/^https?:\/\/([^.]+)\./)?.[1] ?? "";
  if (!ref) return null;
  return { url, key, storageKey: `sb-${ref}-auth-token` };
}

async function writeStorageState(
  baseURL: string,
  storageKey: string,
  session: unknown,
  cookies: unknown[] = [],
) {
  const state = {
    cookies,
    origins: [
      {
        origin: new URL(baseURL).origin,
        localStorage: [{ name: storageKey, value: JSON.stringify(session) }],
      },
    ],
  };
  await writeFile(STORAGE, JSON.stringify(state, null, 2), "utf8");
}

/** Strategi 1 — sesi yang sudah disuntikkan environment. */
async function fromInjectedSession(baseURL: string): Promise<boolean> {
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  const storageKey =
    process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ||
    supabaseConfig()?.storageKey;
  if (!sessionJson || !storageKey) return false;
  let cookies: unknown[] = [];
  try {
    const raw = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;
    if (raw) {
      cookies = (JSON.parse(raw) as Record<string, unknown>[]).map((c) => ({
        ...c,
        url: new URL(baseURL).origin,
      }));
    }
  } catch {
    cookies = [];
  }
  await writeStorageState(baseURL, storageKey, JSON.parse(sessionJson), cookies);
  console.log("[auth-setup] sesi diambil dari environment terinjeksi.");
  return true;
}

/** Strategi 2 — password grant langsung ke Supabase Auth. */
async function fromPasswordGrant(baseURL: string): Promise<boolean> {
  const cfg = supabaseConfig();
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;
  if (!cfg || !email || !password) return false;
  try {
    const res = await fetch(
      `${cfg.url}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: cfg.key, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
    );
    if (!res.ok) {
      console.warn(
        `[auth-setup] password grant gagal (${res.status}) — coba login UI.`,
      );
      return false;
    }
    const session = (await res.json()) as Record<string, unknown>;
    if (!session?.access_token) return false;
    if (typeof session.expires_in === "number" && !session.expires_at) {
      session.expires_at = Math.floor(Date.now() / 1000) + session.expires_in;
    }
    await writeStorageState(baseURL, cfg.storageKey, session);
    console.log("[auth-setup] sesi didapat via password grant Supabase.");
    return true;
  } catch (err) {
    console.warn("[auth-setup] password grant error:", (err as Error).message);
    return false;
  }
}

/** Strategi 3 — login lewat form UI. */
async function fromUiLogin(baseURL: string): Promise<boolean> {
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;
  if (!email || !password) return false;
  const browser = await chromium.launch(
    process.env.PWTEST_CHROMIUM_PATH
      ? { executablePath: process.env.PWTEST_CHROMIUM_PATH }
      : {},
  );
  try {
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("alamat@email.com").fill(email);
    await page.getByPlaceholder(/Kata sandi/).first().fill(password);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30_000 }),
      page.getByRole("button", { name: "Masuk" }).click(),
    ]);
    if (page.url().includes("/device-verify")) {
      console.warn(
        "[auth-setup] mendarat di /device-verify — percayai perangkat sekali secara manual.",
      );
    }
    await ctx.storageState({ path: STORAGE });
    console.log("[auth-setup] sesi didapat via login UI.");
    return true;
  } catch (err) {
    console.warn("[auth-setup] login UI gagal:", (err as Error).message);
    return false;
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(_config: FullConfig) {
  await mkdir(dirname(STORAGE), { recursive: true });
  const baseURL = process.env.BASE_URL ?? "http://localhost:5173";

  const ok =
    (await fromInjectedSession(baseURL)) ||
    (await fromPasswordGrant(baseURL)) ||
    (await fromUiLogin(baseURL));

  if (ok) return;

  const msg =
    "[auth-setup] tidak ada sesi login. Setel TEST_EMAIL/TEST_PASSWORD " +
    "(atau LOVABLE_BROWSER_SUPABASE_SESSION_JSON) supaya spec terautentikasi " +
    "tidak self-skip.";
  if (process.env.PWTEST_REQUIRE_AUTH === "1") throw new Error(msg);
  console.warn(msg);
  // Tulis state kosong supaya spec bisa self-skip dengan pesan jelas.
  await writeFile(STORAGE, JSON.stringify({ cookies: [], origins: [] }), "utf8");
}
