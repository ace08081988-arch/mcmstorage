import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/ai-ping")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return Response.json(
            { ok: false, stage: "config", error: "LOVABLE_API_KEY missing" },
            { status: 500 },
          );
        }
        const startedAt = Date.now();
        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Lovable-API-Key": key,
              "X-Lovable-AIG-SDK": "diagnostic",
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
          try { body = JSON.parse(text); } catch {}
          const content =
            (body as any)?.choices?.[0]?.message?.content?.toString().trim() ?? "";
          const ok = res.ok && /pong/i.test(content);
          return Response.json(
            {
              ok,
              status: res.status,
              elapsedMs,
              reply: content || null,
              runId: res.headers.get("X-Lovable-AIG-Run-ID"),
              error: ok ? null : (body as any)?.error ?? "unexpected response",
            },
            { status: ok ? 200 : 502 },
          );
        } catch (err) {
          return Response.json(
            { ok: false, stage: "fetch", error: (err as Error).message },
            { status: 500 },
          );
        }
      },
    },
  },
});