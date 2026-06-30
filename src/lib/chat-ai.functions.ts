import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const translateSchema = z.object({
  text: z.string().min(1).max(4000),
  target: z.enum(["id", "en"]).default("id"),
});

export const translateMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => translateSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Lovable AI belum dikonfigurasi");

    const targetName = data.target === "en" ? "English" : "Indonesian";
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
          {
            role: "system",
            content: `You are a precise translator. Detect the source language and translate the user's message into ${targetName}. Output ONLY the translated text, no quotes, no explanations.`,
          },
          { role: "user", content: data.text },
        ],
      }),
    });

    if (res.status === 429) throw new Error("Batas pemakaian tercapai, coba beberapa saat lagi.");
    if (res.status === 402) throw new Error("Kredit AI habis. Tambah kredit untuk lanjut menerjemahkan.");
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Gagal terjemahkan (${res.status}) ${t.slice(0, 200)}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const out = json.choices?.[0]?.message?.content?.trim() ?? "";
    return { translation: out, target: data.target };
  });