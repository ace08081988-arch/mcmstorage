/**
 * Integration test: memastikan rate limiting per-IP tetap ditegakkan
 * meskipun jalur dev-bypass Turnstile aktif. Ini mencegah regresi di
 * mana bypass captcha juga secara tidak sengaja melewati RPC
 * `check_and_record_signup_attempt`.
 *
 * Invariant yang diuji:
 *  1. Dev-bypass valid + RPC menolak (allowed=false) → hasil `rate_limited`,
 *     `createUser` TIDAK dipanggil, dan `siteverify` TIDAK dipanggil.
 *  2. Dev-bypass valid + RPC error → hasil `server_error`, `createUser`
 *     TIDAK dipanggil.
 *  3. Dev-bypass valid + RPC allow → sukses (baseline, memastikan matrix
 *     rate-limit yang menolak di atas benar-benar disebabkan oleh RPC,
 *     bukan short-circuit lain).
 *  4. RPC `check_and_record_signup_attempt` SELALU dipanggil pada jalur
 *     dev-bypass (tidak ada shortcut yang melewati counter).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function makeRequest(ip: string): Request {
  return new Request("http://localhost/", {
    headers: { "cf-connecting-ip": ip, "user-agent": "vitest" },
  });
}

function chainable(finalResult: unknown) {
  const p: Record<string, unknown> = {};
  const methods = [
    "select","insert","update","delete","upsert","eq","neq","gt","gte",
    "lt","lte","in","is","order","limit","range",
  ];
  for (const m of methods) p[m] = vi.fn(() => p);
  p.maybeSingle = vi.fn(() => Promise.resolve(finalResult));
  p.single = vi.fn(() => Promise.resolve(finalResult));
  (p as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve(finalResult);
  return p;
}

const createUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => fromMock(table),
    rpc: (...args: unknown[]) => rpcMock(...args),
    auth: { admin: { createUser: (...args: unknown[]) => createUserMock(...args) } },
  },
}));

import { secureSignUpImpl } from "./auth.functions";
import { DEV_TURNSTILE_TOKEN } from "./turnstile-dev";

const originalFetch = global.fetch;
const originalNodeEnv = process.env.NODE_ENV;
const originalSecret = process.env.TURNSTILE_SECRET_KEY;

function installBaseMocks() {
  fromMock.mockImplementation((table: string) => {
    if (table === "turnstile_config") {
      return chainable({ data: { secret_key: "" }, error: null });
    }
    if (table === "signup_attempts") {
      return chainable({ data: [{ id: 1 }], error: null });
    }
    return chainable({ data: null, error: null });
  });
  createUserMock.mockResolvedValue({
    data: { user: { id: "user-id-1" } },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installBaseMocks();
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  process.env.NODE_ENV = "development";
  // fetch spy — harus TIDAK dipanggil pada jalur dev-bypass.
  global.fetch = vi.fn(async () => {
    throw new Error("fetch should not be called under valid dev-bypass");
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.NODE_ENV = originalNodeEnv;
  if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = originalSecret;
});

const baseInput = {
  email: "user@example.com",
  password: "SuperSecret123!",
  turnstileToken: DEV_TURNSTILE_TOKEN,
  chatOnly: false,
};

describe("secureSignUp: rate limit tetap aktif meski dev-bypass Turnstile lolos", () => {
  it("RPC menolak (allowed=false) → rate_limited walau dev-bypass valid; createUser tidak dipanggil", async () => {
    rpcMock.mockResolvedValue({
      data: [{ allowed: false, attempts_in_window: 13, retry_after_seconds: 1800 }],
      error: null,
    });

    const result = await secureSignUpImpl(baseInput, makeRequest("127.0.0.1"));

    expect(result).toMatchObject({
      ok: false,
      code: "rate_limited",
      retryAfterSeconds: 1800,
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "check_and_record_signup_attempt",
      expect.objectContaining({ p_ip: "127.0.0.1", p_email: "user@example.com" }),
    );
    expect(createUserMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Semua alias loopback tetap terkena rate limit ketika RPC menolak", async () => {
    rpcMock.mockResolvedValue({
      data: [{ allowed: false, attempts_in_window: 20, retry_after_seconds: 600 }],
      error: null,
    });

    for (const ip of ["127.0.0.1", "::1", "0.0.0.0", "::ffff:127.0.0.1"]) {
      vi.clearAllMocks();
      installBaseMocks();
      rpcMock.mockResolvedValue({
        data: [{ allowed: false, attempts_in_window: 20, retry_after_seconds: 600 }],
        error: null,
      });

      const result = await secureSignUpImpl(baseInput, makeRequest(ip));
      expect(result, `ip=${ip}`).toMatchObject({ ok: false, code: "rate_limited" });
      expect(rpcMock, `ip=${ip}`).toHaveBeenCalledTimes(1);
      expect(createUserMock, `ip=${ip}`).not.toHaveBeenCalled();
    }
  });

  it("RPC error → server_error walau dev-bypass valid; createUser tidak dipanggil", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "db down" } });

    const result = await secureSignUpImpl(baseInput, makeRequest("127.0.0.1"));

    expect(result).toMatchObject({ ok: false, code: "server_error" });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("Baseline: dev-bypass + RPC allow → sukses (memastikan penolakan di atas benar-benar dari rate-limit)", async () => {
    rpcMock.mockResolvedValue({
      data: [{ allowed: true, attempts_in_window: 1, retry_after_seconds: 0 }],
      error: null,
    });

    const result = await secureSignUpImpl(baseInput, makeRequest("127.0.0.1"));

    expect(result).toEqual({ ok: true, userId: "user-id-1" });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("Invariant: RPC rate-limit SELALU dipanggil pada jalur dev-bypass (tidak ada shortcut)", async () => {
    // Simulasikan 5 percobaan berturut-turut dari IP loopback yang sama.
    // Setiap satu WAJIB memanggil RPC — kalau ada shortcut, hitungan turun.
    const responses = [
      { allowed: true, attempts_in_window: 1, retry_after_seconds: 0 },
      { allowed: true, attempts_in_window: 2, retry_after_seconds: 0 },
      { allowed: true, attempts_in_window: 3, retry_after_seconds: 0 },
      { allowed: false, attempts_in_window: 13, retry_after_seconds: 120 },
      { allowed: false, attempts_in_window: 14, retry_after_seconds: 60 },
    ];
    let i = 0;
    rpcMock.mockImplementation(() =>
      Promise.resolve({ data: [responses[i++]], error: null }),
    );

    const results: Array<{ ok: boolean }> = [];
    for (let n = 0; n < 5; n++) {
      results.push(await secureSignUpImpl(baseInput, makeRequest("127.0.0.1")));
    }

    expect(rpcMock).toHaveBeenCalledTimes(5);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[2]).toMatchObject({ ok: true });
    expect(results[3]).toMatchObject({ ok: false, code: "rate_limited" });
    expect(results[4]).toMatchObject({ ok: false, code: "rate_limited" });
    // Setelah rate-limit menolak, createUser hanya jalan untuk 3 request pertama.
    expect(createUserMock).toHaveBeenCalledTimes(3);
  });
});