import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForCaller } from "../supabase";

export default defineTool({
  name: "list_produk",
  title: "Daftar produk / stok",
  description:
    "Mengambil daftar produk (stok) milik user MCM Storage yang sedang terhubung. Filter opsional lewat query pencarian pada nama.",
  inputSchema: {
    query: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe("Kata kunci pencarian nama produk (opsional)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Jumlah baris maksimum. Default 25, maksimum 100."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Tidak terautentikasi" }], isError: true };
    }
    const supabase = supabaseForCaller(ctx);
    let q = supabase
      .from("warehouse_items")
      .select("id, name, category, stock_base, base_unit, package_type, package_size, updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit ?? 25);
    if (query) q = q.ilike("name", `%${query}%`);
    const { data, error } = await q;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { items: data ?? [] },
    };
  },
});