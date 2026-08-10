import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForCaller } from "../supabase";

export default defineTool({
  name: "whoami",
  title: "Siapa saya",
  description:
    "Mengembalikan identitas user Ace Storage yang sedang terhubung via MCP (id, email, dan role admin bila ada). Berguna untuk verifikasi koneksi.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Tidak terautentikasi" }], isError: true };
    }
    const userId = ctx.getUserId();
    if (!userId) {
      return { content: [{ type: "text", text: "Tidak terautentikasi" }], isError: true };
    }
    const email = ctx.getUserEmail() ?? null;
    const supabase = supabaseForCaller(ctx);
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    const payload = { user_id: userId, email, roles };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});