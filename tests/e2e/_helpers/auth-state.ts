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
