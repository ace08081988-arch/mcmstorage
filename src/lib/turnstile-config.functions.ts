import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TurnstileConfig = {
  site_key: string;
  secret_key_masked: string;
  has_secret: boolean;
  updated_at: string | null;
};

/**
 * Public: mengembalikan site_key Turnstile dari DB (fallback env).
 * Dapat dipanggil tanpa autentikasi karena site_key memang publik.
 */
export const getTurnstileSiteKey = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ siteKey: string }> => {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
      );
      const { data } = await supabase.rpc("get_turnstile_site_key" as never);
      const fromDb = typeof data === "string" ? data.trim() : "";
      if (fromDb) return { siteKey: fromDb };
    } catch {
      /* fall through to env */
    }
    return { siteKey: (process.env.VITE_TURNSTILE_SITE_KEY ?? "").trim() };
  },
);

/**
 * Admin only: baca config lengkap (secret dimask).
 */
export const getTurnstileConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TurnstileConfig> => {
    const isAdmin = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin.data) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("turnstile_config")
      .select("site_key, secret_key, updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const stored = (data?.secret_key ?? "") as string;
    // Mask harus dihitung dari PLAINTEXT, bukan ciphertext — mask ciphertext
    // hanya membocorkan panjang blob acak.
    let plaintext = "";
    if (stored) {
      try {
        const { decryptTurnstileSecret } = await import("./turnstile-crypto.server");
        plaintext = decryptTurnstileSecret(stored);
      } catch (err) {
        console.error("[getTurnstileConfig] dekripsi gagal", err);
      }
    }
    const { maskTurnstileSecret } = await import("./turnstile-crypto.server");
    const masked = maskTurnstileSecret(plaintext);
    return {
      site_key: (data?.site_key ?? "") as string,
      secret_key_masked: masked,
      has_secret: Boolean(stored),
      updated_at: (data?.updated_at ?? null) as string | null,
    };
  });

const updateSchema = z.object({
  site_key: z.string().trim().max(200),
  // Empty string = jangan ubah secret; nilai lain = replace.
  secret_key: z.string().max(200),
  clear_secret: z.boolean().optional().default(false),
});

export const updateTurnstileConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const isAdmin = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin.data) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      site_key: string;
      updated_by: string;
      secret_key?: string;
    } = {
      site_key: data.site_key,
      updated_by: context.userId,
    };
    if (data.clear_secret) {
      patch.secret_key = "";
    } else if (data.secret_key.trim().length > 0) {
      const { encryptTurnstileSecret } = await import("./turnstile-crypto.server");
      patch.secret_key = encryptTurnstileSecret(data.secret_key.trim());
    }
    const { error } = await supabaseAdmin
      .from("turnstile_config")
      .update(patch)
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Admin only: validasi secret key Turnstile ke endpoint siteverify Cloudflare.
 *
 * Strategi: kirim token dummy. Cloudflare akan membalas dengan `error-codes`:
 *  - `invalid-input-secret`  → secret salah/tidak dikenal.
 *  - `missing-input-secret`  → secret kosong.
 *  - `invalid-input-response` / `missing-input-response` → secret DITERIMA,
 *    tapi token yang dites tidak valid. Ini yang kita anggap "secret valid".
 *
 * Jika `secret_key` diisi (belum tersimpan), pakai itu. Kalau kosong, pakai
 * secret yang tersimpan di DB (fallback env).
 */
const testSchema = z.object({
  secret_key: z.string().max(200).optional().default(""),
});

export type TurnstileSecretTestResult = {
  ok: boolean;
  source: "input" | "database" | "env" | "none";
  codes: string[];
  message: string;
  http_status?: number;
  duration_ms?: number;
  messages?: string[];
  request_id?: string | null;
  cf_ray?: string | null;
  hostname?: string | null;
  challenge_ts?: string | null;
  action?: string | null;
  raw?: string;
};

export const testTurnstileSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => testSchema.parse(data))
  .handler(async ({ data, context }): Promise<TurnstileSecretTestResult> => {
    const isAdmin = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin.data) throw new Error("Forbidden");

    let secret = data.secret_key.trim();
    let source: TurnstileSecretTestResult["source"] = "input";
    if (!secret) {
      try {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { data: cfg } = await supabaseAdmin
          .from("turnstile_config")
          .select("secret_key")
          .eq("id", 1)
          .maybeSingle();
        const stored = ((cfg?.secret_key as string | undefined) ?? "").trim();
        if (stored) {
          try {
            const { decryptTurnstileSecret } = await import(
              "./turnstile-crypto.server"
            );
            const fromDb = decryptTurnstileSecret(stored);
            if (fromDb) {
              secret = fromDb;
              source = "database";
            }
          } catch (err) {
            console.error("[testTurnstileSecret] dekripsi gagal", err);
          }
        }
      } catch {
        /* fall through */
      }
    }
    if (!secret) {
      const fromEnv = (process.env.TURNSTILE_SECRET_KEY ?? "").trim();
      if (fromEnv) {
        secret = fromEnv;
        source = "env";
      }
    }
    if (!secret) {
      return {
        ok: false,
        source: "none",
        codes: ["missing-input-secret"],
        message:
          "Belum ada secret untuk diuji. Isi field Secret Key dulu lalu klik Uji.",
      };
    }

    const body = new URLSearchParams();
    body.set("secret", secret);
    // Token dummy — pasti gagal, tapi Cloudflare akan tetap memvalidasi secret.
    body.set("response", "test-token-xxxxxxxxxxxxxxxxxxxx");
    const startedAt = Date.now();
    try {
      const res = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        { method: "POST", body },
      );
      const rawText = await res.text();
      let json: {
        success: boolean;
        "error-codes"?: string[];
        messages?: string[];
        hostname?: string;
        challenge_ts?: string;
        action?: string;
      } = { success: false };
      try {
        json = JSON.parse(rawText);
      } catch {
        /* keep default */
      }
      const codes = json["error-codes"] ?? [];
      const durationMs = Date.now() - startedAt;
      const cfRay = res.headers.get("cf-ray");
      const requestId =
        res.headers.get("x-request-id") ??
        res.headers.get("cf-request-id") ??
        null;
      console.info(
        "[turnstile.test]",
        JSON.stringify({
          admin_user_id: context.userId,
          secret_source: source,
          error_codes: codes,
          messages: json.messages ?? null,
          http_status: res.status,
          duration_ms: durationMs,
          cf_ray: cfRay,
          request_id: requestId,
        }),
      );
      // Secret dianggap valid selama Cloudflare TIDAK mengeluh soal secret.
      const secretRejected = codes.some((c) =>
        c === "invalid-input-secret" || c === "missing-input-secret",
      );
      const common = {
        http_status: res.status,
        duration_ms: durationMs,
        messages: json.messages ?? [],
        request_id: requestId,
        cf_ray: cfRay,
        hostname: json.hostname ?? null,
        challenge_ts: json.challenge_ts ?? null,
        action: json.action ?? null,
        raw: rawText.slice(0, 2000),
      };
      if (secretRejected) {
        return {
          ok: false,
          source,
          codes,
          message:
            "Secret key ditolak Cloudflare (" +
            codes.join(", ") +
            "). Periksa kembali secret dari dashboard Turnstile.",
          ...common,
        };
      }
      return {
        ok: true,
        source,
        codes,
        message:
          "Secret key valid. Cloudflare menerima secret (token dummy ditolak seperti yang diharapkan: " +
          (codes.join(", ") || "no-codes") +
          ").",
        ...common,
      };
    } catch (err) {
      return {
        ok: false,
        source,
        codes: ["network_error"],
        message:
          "Gagal menghubungi Cloudflare: " +
          (err instanceof Error ? err.message : String(err)),
        duration_ms: Date.now() - startedAt,
      };
    }
  });