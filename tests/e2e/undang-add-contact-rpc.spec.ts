import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * E2E regresi: `add_contact_by_invite_code` PERNAH melempar
 * `column reference "linked_user_id" is ambiguous` karena kolom
 * `linked_user_id` di WHERE bertabrakan dengan OUT parameter fungsi
 * ber-nama sama. Migrasi berikutnya meng-qualify `ab.linked_user_id`.
 *
 * Kontrak yang di-lock spec ini:
 *   1. Memanggil RPC dengan PIN valid milik user LAIN dari sesi user
 *      test TIDAK boleh menghasilkan error `ambiguous`.
 *   2. RPC mengembalikan row (contact_id, linked_user_id, ...).
 *
 * Self-skip bila:
 *   - storageState kosong (belum login), atau
 *   - `psql` / PG* env tidak tersedia untuk mencari PIN target, atau
 *   - tidak ada user lain dengan `invite_code` di project ini.
 */

const STORAGE = "tests/visual/.auth/user.json";

function hasStorageState(): boolean {
  try {
    if (!existsSync(STORAGE)) return false;
    const raw = JSON.parse(readFileSync(STORAGE, "utf8"));
    return (
      (Array.isArray(raw?.cookies) && raw.cookies.length > 0) ||
      (Array.isArray(raw?.origins) && raw.origins.length > 0)
    );
  } catch {
    return false;
  }
}

function readTestUserId(): string | null {
  try {
    const raw = JSON.parse(readFileSync(STORAGE, "utf8")) as {
      origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
    };
    for (const origin of raw.origins ?? []) {
      for (const kv of origin.localStorage ?? []) {
        if (!/^sb-.*-auth-token$/.test(kv.name)) continue;
        try {
          const parsed = JSON.parse(kv.value) as { user?: { id?: string } };
          if (parsed?.user?.id) return parsed.user.id;
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function fetchOtherInviteCode(excludeUserId: string | null): string | null {
  if (!process.env.PGHOST) return null;
  try {
    const args = ["-Atc"];
    const sql = excludeUserId
      ? `SELECT invite_code FROM public.profiles WHERE invite_code IS NOT NULL AND id <> '${excludeUserId.replace(/'/g, "''")}'::uuid LIMIT 1`
      : `SELECT invite_code FROM public.profiles WHERE invite_code IS NOT NULL LIMIT 1`;
    args.push(sql);
    const out = execFileSync("psql", args, { encoding: "utf8", timeout: 5_000 }).trim();
    return out || null;
  } catch {
    return null;
  }
}

test.describe("undang — add_contact_by_invite_code tidak boleh 'ambiguous'", () => {
  test.skip(!hasStorageState(), "storageState kosong; setup login dulu.");

  test("RPC valid PIN → tidak error 'ambiguous', return row lengkap", async ({ page }) => {
    const meId = readTestUserId();
    const targetCode = fetchOtherInviteCode(meId);
    test.skip(
      !targetCode,
      "Tidak ada PIN user lain di DB (atau psql tidak tersedia) — skip regresi RPC.",
    );

    // Buka route apapun yang berada di bawah `_authenticated/` supaya
    // supabase client browser hidup dan bearer terpasang.
    await page.goto("/undang");
    await expect(
      page.locator('[data-sidebar="menu"] a[href="/chat"]').first(),
    ).toBeVisible({ timeout: 15_000 });

    // Panggil RPC langsung dari konteks browser — reproduksi jalur yang
    // sama dengan tombol "Tambah kontak" (src/lib/invite.ts).
    const result = await page.evaluate(async (code: string) => {
      const mod = await import("/src/integrations/supabase/client.ts");
      const { data, error } = await mod.supabase.rpc(
        "add_contact_by_invite_code",
        { _code: code },
      );
      return {
        error: error ? { message: error.message, code: (error as { code?: string }).code ?? null } : null,
        row: Array.isArray(data) ? data[0] ?? null : data,
      };
    }, targetCode);

    // Kontrak utama: pesan error TIDAK boleh mengandung 'ambiguous'.
    if (result.error) {
      expect(
        result.error.message,
        `RPC error mengandung "ambiguous" — regresi migrasi WHERE ab.linked_user_id kembali.\nFull error: ${JSON.stringify(result.error)}`,
      ).not.toMatch(/ambiguous/i);
    }

    // Kontrak sekunder: RPC harus balikin row valid dengan `linked_user_id`
    // terisi (idempotent — panggilan kedua kalinya `already_existed=true`).
    expect(result.error, `RPC gagal: ${JSON.stringify(result.error)}`).toBeNull();
    expect(result.row).toBeTruthy();
    expect(result.row?.contact_id).toBeTruthy();
    expect(result.row?.linked_user_id).toBeTruthy();
  });
});