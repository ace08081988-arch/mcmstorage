/**
 * Ingest Core Web Vitals dari pengunjung katalog publik.
 *
 * Endpoint publik (dipanggil `sendBeacon` tanpa login), jadi payload
 * divalidasi ketat dan hanya kolom non-PII yang disimpan. Penulisan lewat
 * service role supaya tabel tetap tertutup untuk anon.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  page: z.enum(["katalog_list", "katalog_detail"]),
  slug: z.string().trim().max(48).nullable().optional(),
  metric: z.enum(["LCP", "CLS", "INP", "TTFB", "FCP"]),
  value: z.number().finite().min(0).max(599_999),
  rating: z.enum(["good", "needs-improvement", "poor"]),
  navType: z.string().trim().max(32).nullable().optional(),
  device: z.enum(["mobile", "desktop", "unknown"]).default("unknown"),
  releaseTag: z.string().trim().max(64).nullable().optional(),
});

export const Route = createFileRoute("/api/public/web-vitals")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const raw = await request.json().catch(() => null);
          const parsed = schema.safeParse(raw);
          if (!parsed.success) {
            return Response.json({ ok: false, error: "bad_payload" }, { status: 400 });
          }
          const d = parsed.data;
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("web_vital_samples").insert({
            page: d.page,
            slug: d.slug ?? null,
            metric: d.metric,
            value: d.value,
            rating: d.rating,
            nav_type: d.navType ?? null,
            device: d.device,
            release_tag: d.releaseTag ?? null,
          });
          if (error) {
            return Response.json({ ok: false, error: "insert_failed" }, { status: 500 });
          }
          return Response.json({ ok: true });
        } catch {
          return Response.json({ ok: false, error: "internal" }, { status: 500 });
        }
      },
    },
  },
});