import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  prompt: z.string().min(2).max(400),
});

/**
 * Generate gambar stiker via Lovable AI Gateway (non-streaming, gpt-image-2 low).
 * Mengembalikan base64 PNG; klien meng-upload ke bucket chat-attachments
 * lalu menyimpan path-nya di kartu stiker. Caption/rotasi/skala diedit
 * sepenuhnya di sisi klien — tidak menghasilkan ulang gambar di AI.
 */
export const generateAiSticker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Lovable AI belum dikonfigurasi");

    const fullPrompt =
      `Vector sticker illustration of: ${data.prompt}. ` +
      `Centered subject, bold thick outline, flat saturated colors, ` +
      `clean white background, no text, no watermark, square crop.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "raw-fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-image-2",
        prompt: fullPrompt,
        size: "1024x1024",
        quality: "low",
        n: 1,
      }),
    });

    if (res.status === 429) throw new Error("Batas pemakaian AI tercapai, coba sebentar lagi.");
    if (res.status === 402) throw new Error("Kredit AI habis. Tambah kredit untuk lanjut.");
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Gagal membuat stiker (${res.status}) ${t.slice(0, 200)}`);
    }

    const json = (await res.json()) as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      const m = json.error?.message ?? "Respons AI tidak berisi gambar.";
      throw new Error(m);
    }
    return { b64_json: b64 };
  });
