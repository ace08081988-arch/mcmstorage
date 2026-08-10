import { describe, it, expect, vi } from "vitest";
import { buildEmailQueueStatus } from "@/lib/email-queue.functions";

/**
 * Regresi: `getEmailQueueStatus` TIDAK boleh throw "Forbidden: admin
 * diperlukan" untuk user non-admin. Harus mengembalikan payload kosong
 * `{isAdmin:false, health:null, recentOtp:[], …}` supaya route
 * `/email-queue` bisa merender fallback "Halaman ini hanya untuk admin."
 * tanpa crash / blank.
 */
function makeCtx(isAdmin: boolean) {
  const rpc = vi.fn(async () => ({ data: isAdmin, error: null }));
  return { userId: "u-non-admin", supabase: { rpc }, _rpc: rpc };
}

describe("buildEmailQueueStatus — kontrak non-admin", () => {
  it("non-admin: return payload kosong dengan isAdmin:false, tidak throw", async () => {
    const ctx = makeCtx(false);
    const res = await buildEmailQueueStatus(ctx);
    expect(res.isAdmin).toBe(false);
    expect(res.health).toBeNull();
    expect(res.recentOtp).toEqual([]);
    expect(res.cronProcessLastRun).toBeNull();
    expect(res.cronProcessNextRun).toBeNull();
  });

  it("memanggil has_role dengan role='admin' persis sekali", async () => {
    const ctx = makeCtx(false);
    await buildEmailQueueStatus(ctx);
    expect(ctx._rpc).toHaveBeenCalledTimes(1);
    expect(ctx._rpc).toHaveBeenCalledWith("has_role", {
      _user_id: "u-non-admin",
      _role: "admin",
    });
  });

  it("resolve (tidak throw) meski payload isAdmin=false", async () => {
    const ctx = makeCtx(false);
    await expect(buildEmailQueueStatus(ctx)).resolves.toBeDefined();
  });
});
