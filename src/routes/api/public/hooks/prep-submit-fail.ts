import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Endpoint publik untuk laporan submit GAGAL dari halaman pegawai /t/:token.
// Verifikasi via prep_task_resolve (SECURITY DEFINER, cek pin_hash & expires_at).
// Bila konfigurasi WA hook aktif, teruskan ke forward_url (n8n) dgn kind='prep_submit_fail'.

const payloadSchema = z.object({
  token: z.string().min(4).max(64),
  pin: z.string().min(3).max(16),
  error: z.string().min(1).max(1000),
  kind_hint: z.enum(["ecer", "paket"]).nullable().optional(),
  item_name: z.string().max(200).nullable().optional(),
});

export const Route = createFileRoute("/api/public/hooks/prep-submit-fail")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof payloadSchema>;
        try {
          parsed = payloadSchema.parse(await request.json());
        } catch (err) {
          return Response.json(
            { ok: false, error: "invalid_payload", detail: err instanceof Error ? err.message : String(err) },
            { status: 400 },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 1) Verifikasi token + PIN
        const { data: resolveData, error: resolveErr } = await supabaseAdmin.rpc("prep_task_resolve" as never, {
          _token: parsed.token,
          _pin: parsed.pin,
        } as never);
        if (resolveErr) {
          return Response.json({ ok: false, error: "resolve_failed", detail: resolveErr.message }, { status: 500 });
        }
        const res = resolveData as { ok?: boolean; error?: string; task_id?: string; owner_user_id?: string; title?: string } | null;
        if (!res?.ok) {
          return Response.json({ ok: false, error: res?.error ?? "unauthorized" }, { status: 401 });
        }

        // 2) Baca konfigurasi hook (singleton)
        const { data: cfg } = await supabaseAdmin
          .from("prep_submit_wa_hook")
          .select("forward_url, wa_target, enabled")
          .eq("id", true)
          .maybeSingle();

        if (!cfg || !cfg.enabled || !cfg.forward_url) {
          return Response.json({ ok: true, skipped: "hook_disabled" });
        }

        // 3) Teruskan ke forward_url (mis. n8n) — n8n meneruskan ke WA
        const body = {
          kind: parsed.kind_hint === "paket" ? "prep_submit_fail_paket" : "prep_submit_fail_ecer",
          wa_target: cfg.wa_target,
          title: res.title ?? null,
          item_name: parsed.item_name ?? null,
          error: parsed.error,
          task_id: res.task_id,
          submitted_at: new Date().toISOString(),
        };

        try {
          const fwd = await fetch(cfg.forward_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          return Response.json({ ok: true, forwarded_status: fwd.status });
        } catch (e) {
          return Response.json(
            { ok: false, error: "forward_failed", detail: e instanceof Error ? e.message : String(e) },
            { status: 502 },
          );
        }
      },
    },
  },
});