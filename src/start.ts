import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/lovable/")) {
    return next();
  }

  try {
    return await next();
  } catch (error) {
    // `requireSupabaseAuth` (dan kode lain) melempar `Response` — mis. 401
    // Unauthorized saat sesi belum siap. Itu jawaban HTTP yang sah, bukan
    // crash: teruskan apa adanya supaya klien menerima 401 dan bisa
    // memulihkan sesi, bukan halaman error 500.
    if (error instanceof Response) {
      return error;
    }
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    // Build/chunk basi: klien memanggil ID server function dari bundel lama
    // yang sudah tidak ada di server. Ini bukan crash aplikasi — balas JSON
    // 410 dengan pesan aslinya supaya `chunk-recovery.ts` mengenalinya dan
    // melakukan hard reload, bukan menampilkan layar error 500.
    const message = error instanceof Error ? error.message : String(error);
    if (/Invalid server function ID|Server function info not found/i.test(message)) {
      console.warn(message);
      return new Response(JSON.stringify({ error: message, stale: true }), {
        status: 410,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
