import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { timingSafeEqual } from "crypto";

// M2: constant-time compare untuk hindari timing-oracle di secret verification.
function safeSecretEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Dipanggil oleh trigger DB `trg_notify_prep_task_via_hook` via pg_net saat
// admin membuat tugas penyiapan baru dan menugaskannya ke pegawai.
// Autentikasi: header `x-hook-secret` harus cocok dgn env
// `BUSINESS_NOTIFY_HOOK_SECRET` (dipakai bersama dgn hook order-event).

const payloadSchema = z.object({
  kind: z.literal("prep_task_assigned"),
  task_id: z.string().uuid(),
  owner_user_id: z.string().uuid().nullable().optional(),
  employee_id: z.string().uuid(),
  title: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  scheduled_at: z.string().nullable().optional(),
  item_count: z.number().int().nonnegative().nullable().optional(),
  first_item_name: z.string().nullable().optional(),
  actor_user_id: z.string().uuid().nullable().optional(),
});

export const Route = createFileRoute("/api/public/hooks/prep-task-notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.BUSINESS_NOTIFY_HOOK_SECRET;
        if (!expected) {
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }
        const provided = request.headers.get("x-hook-secret") ?? "";
        if (!safeSecretEq(provided, expected)) {
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

        // Penerima: pegawai yg ditugaskan. Kalau actor = pegawai sendiri
        // (misal admin sekaligus pegawai), skip supaya tidak notif diri sendiri.
        const recipients = new Set<string>([parsed.employee_id]);
        if (parsed.actor_user_id) recipients.delete(parsed.actor_user_id);
        if (recipients.size === 0) {
          return Response.json({ success: true, skipped: "no_recipients" });
        }

        const titleText = parsed.title?.trim() || "Tugas penyiapan baru";
        const count = parsed.item_count ?? 0;
        const firstItem = parsed.first_item_name?.trim() || "";
        const bodyParts: string[] = [];
        if (count > 0) {
          bodyParts.push(
            count === 1 && firstItem
              ? firstItem
              : firstItem
                ? `${firstItem} + ${count - 1} item lain`
                : `${count} item`,
          );
        }
        if (parsed.note?.trim()) bodyParts.push(parsed.note.trim());
        const body = bodyParts.join(" · ") || "Tugas baru menunggu penyiapan";

        try {
          const { notifyUsers } = await import("@/lib/push.server");
          const result = await notifyUsers({
            userIds: Array.from(recipients),
            payload: {
              title: `Tugas baru: ${titleText}`,
              body,
              // H18: /pegawai/tugas/... tidak ada; arahkan ke daftar tugas.
              url: `/tugas-daftar`,
              tag: `prep-task:${parsed.task_id}`,
              // H19: samakan dgn enabledKinds di SW (chat/tugas/order/system)
              // supaya toggle "Notifikasi Tugas" pengguna benar-benar berlaku.
              kind: "tugas",
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