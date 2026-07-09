import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Dipanggil oleh trigger DB `trg_notify_friend_request_via_hook` via pg_net
// setiap kali sebuah friend_request dibuat, diterima, atau ditolak.
// Auth: header `x-hook-secret` harus cocok dgn `BUSINESS_NOTIFY_HOOK_SECRET`
// (dipakai bersama dgn hook order-event & prep-task).

const payloadSchema = z.object({
  kind: z.enum(["friend_request_new", "friend_request_accepted", "friend_request_rejected"]),
  request_id: z.string().uuid(),
  from_user: z.string().uuid(),
  to_user: z.string().uuid(),
  status: z.string().nullable().optional(),
});

type Audience = "to" | "from";

type Copy = { title: string; body: (name: string) => string; audience: Audience; url: string };

function copyFor(kind: z.infer<typeof payloadSchema>["kind"]): Copy {
  switch (kind) {
    case "friend_request_new":
      return {
        title: "Permintaan kontak baru",
        body: (n) => `${n} ingin terhubung`,
        audience: "to",
        url: "/kontak/permintaan",
      };
    case "friend_request_accepted":
      return {
        title: "Permintaan kontak diterima",
        body: (n) => `${n} menerima permintaan Anda`,
        audience: "from",
        url: "/kontak",
      };
    case "friend_request_rejected":
      return {
        title: "Permintaan kontak ditolak",
        body: (n) => `${n} menolak permintaan Anda`,
        audience: "from",
        url: "/kontak",
      };
  }
}

export const Route = createFileRoute("/api/public/hooks/friend-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.BUSINESS_NOTIFY_HOOK_SECRET;
        if (!expected) {
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }
        const provided = request.headers.get("x-hook-secret") ?? "";
        if (provided.length !== expected.length || provided !== expected) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let parsed: z.infer<typeof payloadSchema>;
        try {
          parsed = payloadSchema.parse(await request.json());
        } catch (err) {
          return Response.json(
            { error: "Invalid payload", detail: err instanceof Error ? err.message : String(err) },
            { status: 400 },
          );
        }

        const copy = copyFor(parsed.kind);
        // Penerima: sisi yg perlu tahu, actor di-exclude.
        // - new     → to_user (from_user = actor)
        // - accept  → from_user (to_user = actor yg menerima)
        // - reject  → from_user (to_user = actor yg menolak)
        const recipientId = copy.audience === "to" ? parsed.to_user : parsed.from_user;
        const actorId = copy.audience === "to" ? parsed.from_user : parsed.to_user;

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { notifyUsers } = await import("@/lib/push.server");

          const { data: actor } = await supabaseAdmin
            .from("profiles")
            .select("display_name, avatar_url")
            .eq("id", actorId)
            .maybeSingle();

          const actorName = actor?.display_name?.trim() || "Pengguna";

          const result = await notifyUsers({
            userIds: [recipientId],
            payload: {
              title: copy.title,
              body: copy.body(actorName),
              url: copy.url,
              tag: `friend:${parsed.request_id}:${parsed.kind}`,
              icon: actor?.avatar_url || undefined,
              kind: "generic",
              requireInteraction: false,
              vibrate: [80, 40, 80],
              timestamp: Date.now(),
            },
          });
          return Response.json({ success: true, ...result });
        } catch (e) {
          return Response.json(
            { error: "notify_failed", detail: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});