/**
 * Integration test untuk alur `secureSignUp` end-to-end (dalam proses):
 * memastikan Turnstile hanya di-bypass ketika KETIGA kondisi terpenuhi:
 *   - IP klien loopback
 *   - NODE_ENV bukan "production"
 *   - Token tepat "dev-bypass"
 * Untuk kombinasi lain, alur wajib memanggil Cloudflare siteverify.
 *
 * Mocking berlapis:
 *   - `getRequest()` → Request dengan header `cf-connecting-ip` yang bisa
 *     dikontrol per test via hoisted state.
 *   - `@/integrations/supabase/client.server` → supabaseAdmin palsu (secret
 *     dari DB kosong, RPC rate-limit allow, admin.createUser sukses,
 *     signup_attempts update no-op).
 *   - `global.fetch` → mata-mata untuk verifikasi bahwa panggilan siteverify
 *     terjadi (atau tidak).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({ ip: "127.0.0.1" }));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("http://localhost/", {
      headers: {
        "cf-connecting-ip": state.ip,
        "user-agent": "vitest",
      },
    }),
}));

function chainable(finalResult: unknown) {
  const p: Record<string, unknown> = {};
  const methods = [
    "select",
    "insert",
    "update",
    "delete",
    "upsert",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "is",
    "order",
    "limit",
    "range",
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

// Import setelah mock terpasang.
import { secureSignUp } from "./auth.functions";
import { DEV_TURNSTILE_TOKEN } from "./turnstile-dev";

const originalFetch = global.fetch;
const originalNodeEnv = process.env.NODE_ENV;
const originalSecret = process.env.TURNSTILE_SECRET_KEY;

function installMocks() {
  fromMock.mockImplementation((table: string) => {
    if (table === "turnstile_config") {
      // Kosong → memaksa fallback ke env TURNSTILE_SECRET_KEY.
      return chainable({ data: { secret_key: "" }, error: null });
    }
    if (table === "signup_attempts") {
      return chainable({ data: [{ id: 1 }], error: null });
    }
    return chainable({ data: null, error: null });
  });
  rpcMock.mockImplementation((name: string) => {
    if (name === "check_and_record_signup_attempt") {
      return Promise.resolve({
        data: [{ allowed: true, attempts_in_window: 1, retry_after_seconds: 0 }],
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
  createUserMock.mockResolvedValue({
    data: { user: { id: "user-id-1" } },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installMocks();
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  state.ip = "127.0.0.1";
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.NODE_ENV = originalNodeEnv;
  if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = originalSecret;
});

/**
 * Spy fetch — record call ke siteverify, tolak semua panggilan luar tak
 * terduga. Return sukses/gagal sesuai parameter.
 */
function spyFetch(success: boolean) {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("challenges.cloudflare.com/turnstile/v0/siteverify")) {
      return new Response(
        JSON.stringify({
          success,
          "error-codes": success ? [] : ["invalid-input-response"],
        }),
        { status: 200 },
      );
    }
    throw new Error("Unexpected fetch: " + url);
  });
  global.fetch = fetchSpy as unknown as typeof fetch;
  return fetchSpy;
}

const baseInput = {
  email: "user@example.com",
  password: "SuperSecret123!",
  chatOnly: false,
};

describe("secureSignUp integration: dev-bypass gating", () => {
  it("BYPASS lolos: IP loopback + NODE_ENV=development + token dev-bypass → siteverify TIDAK dipanggil, createUser sukses", async () => {
    process.env.NODE_ENV = "development";
    state.ip = "127.0.0.1";
    const fetchSpy = spyFetch(false); // seharusnya tidak terpakai

    const result = await secureSignUp({
      data: { ...baseInput, turnstileToken: DEV_TURNSTILE_TOKEN },
    });

    expect(result).toEqual({ ok: true, userId: "user-id-1" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createUserMock).toHaveBeenCalledTimes(1);
  });

  it("BYPASS lolos untuk semua alias loopback (::1, 0.0.0.0, ::ffff:127.0.0.1)", async () => {
    process.env.NODE_ENV = "test";
    for (const ip of ["::1", "0.0.0.0", "::ffff:127.0.0.1"]) {
      vi.clearAllMocks();
      installMocks();
      state.ip = ip;
      const fetchSpy = spyFetch(false);

      const result = await secureSignUp({
        data: { ...baseInput, turnstileToken: DEV_TURNSTILE_TOKEN },
      });

      expect(result, `ip=${ip}`).toMatchObject({ ok: true });
      expect(fetchSpy, `ip=${ip}`).not.toHaveBeenCalled();
    }
  });

  it("TOLAK: IP publik + dev + token dev-bypass → siteverify dipanggil, gagal → captcha_failed", async () => {
    process.env.NODE_ENV = "development";
    state.ip = "8.8.8.8";
    const fetchSpy = spyFetch(false);

    const result = await secureSignUp({
      data: { ...baseInput, turnstileToken: DEV_TURNSTILE_TOKEN },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, code: "captcha_failed" });
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("TOLAK: IP loopback + NODE_ENV=production + token dev-bypass → siteverify dipanggil", async () => {
    process.env.NODE_ENV = "production";
    state.ip = "127.0.0.1";
    const fetchSpy = spyFetch(false);

    const result = await secureSignUp({
      data: { ...baseInput, turnstileToken: DEV_TURNSTILE_TOKEN },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, code: "captcha_failed" });
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("TOLAK: IP loopback + dev + token BUKAN dev-bypass → siteverify dipanggil", async () => {
    process.env.NODE_ENV = "development";
    state.ip = "127.0.0.1";
    const fetchSpy = spyFetch(false);

    const result = await secureSignUp({
      data: { ...baseInput, turnstileToken: "attacker-supplied-token" },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, code: "captcha_failed" });
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("Token asli Turnstile dari klien tetap divalidasi ke Cloudflare (sukses → createUser jalan)", async () => {
    process.env.NODE_ENV = "production";
    state.ip = "8.8.8.8";
    const fetchSpy = spyFetch(true);

    const result = await secureSignUp({
      data: { ...baseInput, turnstileToken: "real-cf-token-xyz" },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, userId: "user-id-1" });
    expect(createUserMock).toHaveBeenCalledTimes(1);
  });

  it("Matrix negatif: setiap kombinasi non-bypass memanggil siteverify (bukan short-circuit)", async () => {
    const cases: Array<{ ip: string; env: string; token: string }> = [
      { ip: "1.2.3.4", env: "development", token: DEV_TURNSTILE_TOKEN },
      { ip: "127.0.0.1", env: "production", token: DEV_TURNSTILE_TOKEN },
      { ip: "127.0.0.1", env: "development", token: "not-the-magic" },
      { ip: "1.2.3.4", env: "production", token: "cf-real" },
      { ip: "192.168.1.5", env: "test", token: DEV_TURNSTILE_TOKEN },
    ];
    for (const c of cases) {
      vi.clearAllMocks();
      installMocks();
      process.env.NODE_ENV = c.env;
      state.ip = c.ip;
      const fetchSpy = spyFetch(false);

      const result = await secureSignUp({
        data: { ...baseInput, turnstileToken: c.token },
      });

      expect(fetchSpy, JSON.stringify(c)).toHaveBeenCalledTimes(1);
      expect(result, JSON.stringify(c)).toMatchObject({
        ok: false,
        code: "captcha_failed",
      });
    }
  });
});