import { existsSync, readFileSync } from "node:fs";

/**
 * Helper bersama untuk semua spec E2E yang butuh sesi login.
 *
 * `tests/visual/global-setup.ts` menulis storageState terautentikasi ke
 * `AUTH_STORAGE`. Helper ini memutuskan apakah spec boleh self-skip:
 *
 *   - default            → self-skip saat storageState kosong (dev lokal
 *                          tanpa kredensial uji).
 *   - PWTEST_REQUIRE_AUTH=1 → JANGAN skip; gagalkan run dengan pesan jelas
 *                          supaya CI tidak "hijau palsu".
 */
export const AUTH_STORAGE = "tests/visual/.auth/user.json";

export function hasStorageState(path: string = AUTH_STORAGE): boolean {
  try {
    if (!existsSync(path)) return false;
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const hasCookies = Array.isArray(raw?.cookies) && raw.cookies.length > 0;
    const hasOrigins =
      Array.isArray(raw?.origins) &&
      raw.origins.some(
        (o: { localStorage?: unknown[] }) =>
          Array.isArray(o?.localStorage) && o.localStorage.length > 0,
      );
    return hasCookies || hasOrigins;
  } catch {
    return false;
  }
}

export function authRequired(): boolean {
  return process.env.PWTEST_REQUIRE_AUTH === "1";
}

/** Alasan skip (atau null bila sesi tersedia). */
export function authSkipReason(path: string = AUTH_STORAGE): string | null {
  if (hasStorageState(path)) return null;
  return (
    "storageState kosong — setel TEST_EMAIL/TEST_PASSWORD (atau jalankan " +
    "`bun run test:auth-setup`) supaya login otomatis mengisi " +
    `${path}.`
  );
}

type SkipFn = {
  skip: (condition: boolean, reason: string) => void;
  fail?: unknown;
};

/**
 * Pasang guard sesi di level `test.describe`.
 * - Tanpa PWTEST_REQUIRE_AUTH → self-skip seperti sebelumnya.
 * - Dengan PWTEST_REQUIRE_AUTH=1 → lempar error saat kolektor spec jalan.
 */
export function requireAuthState(test: SkipFn, path: string = AUTH_STORAGE): void {
  const reason = authSkipReason(path);
  if (!reason) return;
  if (authRequired()) throw new Error(`[PWTEST_REQUIRE_AUTH] ${reason}`);
  test.skip(true, reason);
}

/** Skip runtime (dalam test body) yang tetap hard-fail di mode wajib-auth. */
export function skipUnlessAuth(
  test: SkipFn,
  condition: boolean,
  reason: string,
): void {
  if (!condition) return;
  if (authRequired()) throw new Error(`[PWTEST_REQUIRE_AUTH] ${reason}`);
  test.skip(true, reason);
}

type EvaluatablePage = {
  evaluate: <R>(fn: (arg?: any) => R | Promise<R>, arg?: any) => Promise<R>;
  reload: (opts?: any) => Promise<any>;
  url: () => string;
};

/**
 * Tandai device browser test sebagai "tepercaya" supaya guard verifikasi
 * device (`/device-verify`, OTP email) tidak memblokir spec. Fingerprint
 * dihitung dengan algoritma yang sama seperti `src/lib/device-fingerprint.ts`.
 *
 * Panggil setelah `page.goto()` pertama ke origin app; halaman di-reload
 * bila guard sempat mengalihkan ke `/device-verify`.
 */
export async function trustTestDevice(page: EvaluatablePage): Promise<void> {
  await page.evaluate(async () => {
    const parts = [
      navigator.userAgent || "",
      navigator.language || "",
      (navigator.languages || []).join(","),
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      navigator.hardwareConcurrency?.toString() || "",
      (navigator as any).deviceMemory?.toString() || "",
    ];
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(parts.join("|")),
    );
    const hash = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const authKey = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    let uid: string | undefined;
    if (authKey) {
      try {
        let raw = localStorage.getItem(authKey) || "";
        if (raw.startsWith("base64-")) raw = atob(raw.slice(7));
        const s = JSON.parse(raw);
        uid = s?.user?.id ?? s?.currentSession?.user?.id;
      } catch {}
    }
    if (uid) localStorage.setItem(`mcm_device_trusted_${uid}_${hash}`, "1");
  });
  if (page.url().includes("/device-verify")) await page.reload({ waitUntil: "domcontentloaded" });
}
