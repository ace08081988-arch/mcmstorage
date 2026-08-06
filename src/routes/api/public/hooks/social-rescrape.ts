/**
 * Endpoint rescrape sosial — dipanggil otomatis setelah publish (atau via
 * pg_cron/GitHub Action) supaya Facebook Sharing Debugger dan X memperbarui
 * kartu tanpa harus dibuka manual.
 *
 * POST /api/public/hooks/social-rescrape
 *   headers: { apikey: <anon key> }   (atau x-rescrape-token: SOCIAL_RESCRAPE_TOKEN)
 *   body:    { urls?: string[], limit?: number }   // kosong = ambil dari sitemap
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  rescrapeUrls,
  selectRescrapeUrls,
  urlsFromSitemapXml,
} from "@/lib/social-rescrape";
import { SITE_URL } from "@/lib/seo-meta";

const BodySchema = z
  .object({
    urls: z.array(z.string().min(1).max(500)).max(50).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

function authorized(request: Request): boolean {
  const apikey = request.headers.get("apikey");
  const token = request.headers.get("x-rescrape-token");
  const expectedKey = process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  const expectedToken = process.env["SOCIAL_RESCRAPE_TOKEN"];
  if (expectedToken && token && token === expectedToken) return true;
  if (expectedKey && apikey && apikey === expectedKey) return true;
  return false;
}

export const Route = createFileRoute("/api/public/hooks/social-rescrape")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        const raw = await request.json().catch(() => ({}));
        const parsed = BodySchema.safeParse(raw ?? {});
        if (!parsed.success) {
          return Response.json({ error: "invalid body" }, { status: 400 });
        }
        const limit = parsed.data.limit ?? 20;

        let urls = parsed.data.urls ?? [];
        if (!urls.length) {
          const res = await fetch(`${SITE_URL}/sitemap.xml`);
          if (!res.ok) {
            return Response.json({ error: "sitemap unavailable" }, { status: 502 });
          }
          urls = selectRescrapeUrls(urlsFromSitemapXml(await res.text()), limit);
        }

        const report = await rescrapeUrls(urls.slice(0, limit), {
          facebookToken: process.env["FACEBOOK_GRAPH_TOKEN"],
        });
        return Response.json(report, { status: report.ok ? 200 : 207 });
      },
    },
  },
});