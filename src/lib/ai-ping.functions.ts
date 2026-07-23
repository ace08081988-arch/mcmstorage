import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Uji nyata ke Lovable AI Gateway. Mengirim satu chat singkat, mengembalikan
 * status, latensi, balasan, dan run id agar bisa dicocokkan di log gateway.
 */
export const pingLovableAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        ok: false as const,
        status: 0,
        elapsedMs: 0,
        reply: null,
        runId: null,
        error: "LOVABLE_API_KEY tidak dikonfigurasi di server.",
      };
    }

    const startedAt = Date.now();
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
          "X-Lovable-AIG-SDK": "raw-fetch",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: "Reply with exactly: pong" },
            { role: "user", content: "ping" },
          ],
        }),
      });
      const elapsedMs = Date.now() - startedAt;
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* keep raw text */
      }
      const reply =
        (body as { choices?: Array<{ message?: { content?: string } }> })
          ?.choices?.[0]?.message?.content?.toString().trim() ?? "";
      const ok = res.ok && /pong/i.test(reply);
      const errMsg = ok
        ? null
        : (body as { error?: { message?: string } | string })?.error
        ? typeof (body as { error?: { message?: string } | string }).error === "string"
          ? String((body as { error?: string }).error)
          : ((body as { error?: { message?: string } }).error?.message ?? "Respons tidak sesuai")
        : `HTTP ${res.status}`;
      return {
        ok,
        status: res.status,
        elapsedMs,
        reply: reply || null,
        runId: res.headers.get("X-Lovable-AIG-Run-ID"),
        error: errMsg,
      };
    } catch (err) {
      return {
        ok: false as const,
        status: 0,
        elapsedMs: Date.now() - startedAt,
        reply: null,
        runId: null,
        error: (err as Error).message,
      };
    }
  });