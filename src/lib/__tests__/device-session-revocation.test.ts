import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock klien supabase: rekam payload upsert supaya kita bisa membuktikan
// bahwa `revoked_at` TIDAK ikut dikirim saat bukan login baru.
const upserts: Array<Record<string, unknown>> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: (row: Record<string, unknown>) => {
        upserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
    auth: { signOut: vi.fn(), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: async () => null }));

import { registerDeviceSession } from "../device-sessions";

describe("registerDeviceSession — pencabutan perangkat tahan reload", () => {
  beforeEach(() => { upserts.length = 0; });

  it("TIDAK mengosongkan revoked_at pada cold start / reload", async () => {
    await registerDeviceSession("user-1");
    expect(upserts).toHaveLength(1);
    expect(Object.hasOwn(upserts[0], "revoked_at")).toBe(false);
  });

  it("mengosongkan revoked_at hanya pada login baru", async () => {
    await registerDeviceSession("user-1", { clearRevocation: true });
    expect(upserts[0]["revoked_at"]).toBeNull();
  });
});
