import { describe, it, expect, vi } from "vitest";
import { buildAdminApkList } from "@/lib/apk.functions";

/**
 * Regresi: `listApkReleaseAdmin` / `listApkReleaseAdminPanel` TIDAK boleh
 * throw untuk user non-admin. Sebagai gantinya keduanya harus mengembalikan
 * payload kosong `{ isAdmin: false, entries: [], minSupported: {…null } }`
 * sehingga UI bisa menampilkan banner "Hanya admin" tanpa runtime error.
 *
 * Kedua server-fn di atas hanyalah pembungkus `buildAdminApkList` +
 * middleware `requireSupabaseAuth`. Untuk mengunci kontrak inti tanpa harus
 * memasang HTTP/Auth, tes ini memanggil `buildAdminApkList` langsung dengan
 * konteks palsu yang meniru bentuk yang dihasilkan middleware.
 */

type RpcArgs = { _user_id: string; _role: string };

function makeContext(isAdmin: boolean) {
  const rpc = vi.fn(async (_fn: string, _args: RpcArgs) => ({
    data: isAdmin,
    error: null,
  }));
  return {
    userId: "user-non-admin",
    claims: {},
    supabase: { rpc },
    _rpc: rpc,
  };
}

describe("buildAdminApkList — kontrak non-admin", () => {
  it("mengembalikan payload kosong dengan isAdmin:false untuk non-admin", async () => {
    const ctx = makeContext(false);
    const result = await buildAdminApkList(ctx);

    expect(result).toEqual({
      isAdmin: false,
      entries: [],
      minSupported: { storage: null, chat: null },
    });
  });

  it("memanggil has_role dengan userId & role='admin' persis sekali", async () => {
    const ctx = makeContext(false);
    await buildAdminApkList(ctx);

    expect(ctx._rpc).toHaveBeenCalledTimes(1);
    expect(ctx._rpc).toHaveBeenCalledWith("has_role", {
      _user_id: "user-non-admin",
      _role: "admin",
    });
  });

  it("tidak throw meski non-admin (regresi 'Forbidden: admin diperlukan')", async () => {
    const ctx = makeContext(false);
    await expect(buildAdminApkList(ctx)).resolves.toBeDefined();
  });

  it("juga aman saat rpc has_role error → dianggap non-admin, tetap tidak throw", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "rpc down" },
    }));
    const ctx = { userId: "u", claims: {}, supabase: { rpc } };
    const result = await buildAdminApkList(ctx);
    expect(result.isAdmin).toBe(false);
    expect(result.entries).toEqual([]);
  });
});