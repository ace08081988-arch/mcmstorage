import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { supabaseForCaller } from "../supabase";

export default defineTool({
  name: "ringkasan_piutang",
  title: "Ringkasan piutang",
  description:
    "Mengembalikan ringkasan piutang (single source of truth) untuk user MCM Storage yang sedang terhubung — total outstanding, jumlah pelanggan berhutang, dan waktu perhitungan terakhir.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Tidak terautentikasi" }], isError: true };
    }
    const supabase = supabaseForCaller(ctx);
    const { data, error } = await supabase.rpc("piutang_summary_v1");
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { summary: data },
    };
  },
});