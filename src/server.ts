import "./lib/error-capture";

import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { withBrandCacheHeaders } from "./lib/brand-cache-headers";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

// Handler dibangun langsung (bukan `import()` dinamis ke server-entry):
// impor dinamis memaksa bundler membuat objek namespace di chunk runtime,
// menghasilkan impor melingkar sehingga worker produksi crash saat boot
// ("createMiddleware is not a function") dan semua route membalas 500.
const startHandler = { fetch: createStartHandler(defaultStreamHandler) } as unknown as ServerEntry;

function getServerEntry(): ServerEntry {
  return startHandler;
}

// Klien yang membatalkan request (tutup tab, scroll cepat, WebView reload)
// memunculkan ECONNRESET / "aborted". Itu bukan error aplikasi.
function isAbortError(error: unknown, request: Request): boolean {
  if (request.signal?.aborted) return true;
  const e = error as { name?: string; message?: string; code?: string; cause?: unknown } | undefined;
  if (!e) return false;
  if (e.name === "AbortError" || e.code === "ECONNRESET") return true;
  if (typeof e.message === "string" && /aborted|ECONNRESET/i.test(e.message)) return true;
  if (e.cause && e.cause !== e) return isAbortError(e.cause, request);
  return false;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const captured = consumeLastCapturedError();
  if (isAbortError(captured, request)) {
    // Koneksi sudah tertutup — jangan render halaman error / laporkan runtime error.
    return new Response(null, { status: 499 });
  }
  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response, request);
      // Aset brand (ikon, manifest, kartu OG) selalu no-cache supaya pratinjau
      // sosial & launcher ikut berubah setelah publish.
      return withBrandCacheHeaders(request, normalized);
    } catch (error) {
      if (isAbortError(error, request)) {
        return new Response(null, { status: 499 });
      }
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
