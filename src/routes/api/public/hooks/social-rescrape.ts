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
import { filterRescrapeUrls } from "@/lib/ssrf-guard";
import {
  clientKeyFromRequest,
  rateLimit,
  rateLimitedResponse,
  readBoundedJson,
  timingSafeEqualStr,
} from "@/lib/edge-guard";

const BodySchema = z
  .object({
    urls: z.array(z.string().min(1).max(500)).max(50).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

/**
 * Otorisasi: hanya secret server (`SOCIAL_RESCRAPE_TOKEN`), dibandingkan
 * konstan-waktu. Anon/publishable key TIDAK lagi diterima — kunci itu ada di
 * bundel browser sehingga siapa pun bisa memicu rescrape. Bila secret belum
 * dipasang, endpoint fail-closed (503).
 */
function authorize(request: Request): "ok" | "unauthorized" | "not_configured" {
  const expectedToken = process.env["SOCIAL_RESCRAPE_TOKEN"];
  if (!expectedToken) return "not_configured";
  const token = request.headers.get("x-rescrape-token") ?? "";
  return token && timingSafeEqualStr(token, expectedToken) ? "ok" : "unauthorized";
}

export const Route = createFileRoute("/api/public/hooks/social-rescrape")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rl = rateLimit(clientKeyFromRequest(request, "rescrape"), {
          limit: 5,
          windowMs: 60_000,
        });
        if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds);

        const auth = authorize(request);
        if (auth === "not_configured") {
          return Response.json(
            { error: "rescrape_secret_not_configured" },
            { status: 503 },
          );
        }
        if (auth === "unauthorized") {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        const body = await readBoundedJson(request, 16 * 1024);
        if (!body.ok) {
          return Response.json({ error: body.error }, { status: body.error === "too_large" ? 413 : 400 });
        }
        const raw = body.value;
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

        // SSRF guard: hanya URL https milik situs sendiri dengan path allowlist.
        const { safe, rejected } = filterRescrapeUrls(urls);
        if (!safe.length) {
          return Response.json({ error: "no_allowed_urls", rejected }, { status: 400 });
        }
        urls = safe;

        const report = await rescrapeUrls(urls.slice(0, limit), {
          facebookToken: process.env["FACEBOOK_GRAPH_TOKEN"],
        });
        return Response.json(
          { ...report, rejected },
          { status: report.ok && rejected.length === 0 ? 200 : 207 },
        );
      },
    },
  },
});