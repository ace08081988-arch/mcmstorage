import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { timingSafeEqual } from "crypto";

// M2: constant-time compare untuk hindari timing-oracle.
function safeSecretEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Dipanggil oleh trigger DB `trg_notify_order_event_via_hook` via pg_net.
// Autentikasi: header x-hook-secret harus cocok dgn env BUSINESS_NOTIFY_HOOK_SECRET.
// Job: kirim push notification ke pemilik toko + pelanggan (bila akunnya tertaut).

const payloadSchema = z.object({
  kind: z.literal("order_event"),
  event_id: z.string().uuid(),
  order_id: z.string().uuid(),
  owner_user_id: z.string().uuid().nullable().optional(),
  customer_account_user_id: z.string().uuid().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  item_name: z.string().nullable().optional(),
  qty: z.union([z.string(), z.number()]).nullable().optional(),
  qty_mode: z.string().nullable().optional(),
  from_status: z.string().nullable().optional(),
  to_status: z.string(),
  note: z.string().nullable().optional(),
  actor_user_id: z.string().uuid().nullable().optional(),
});

type Audience = "owner" | "customer" | "both";

type Copy = { title: string; body: string; audience: Audience; url: string; tag: string };

function statusCopy(input: z.infer<typeof payloadSchema>): Copy | null {
  const st = (input.to_status || "").toLowerCase();
  const item = input.item_name?.trim() || "Pesanan";
  const qtyRaw = input.qty;
  const qty = qtyRaw == null || qtyRaw === "" ? "" : ` · ${qtyRaw}${input.qty_mode ? " " + input.qty_mode : ""}`;
  const cust = input.customer_name?.trim() || "Pelanggan";
  const url = `/pesanan?id=${input.order_id}`;
  const tag = `order:${input.order_id}`;

  // Peta status → copy. Status di luar peta di-skip supaya tidak noise.
  switch (st) {
    case "baru":
    case "request":
    case "pending":
      return {
        title: "Request Order baru",
        body: `${cust} memesan ${item}${qty}`,
        audience: "owner",
        url,
        tag,
      };
    case "menunggu_pembayaran":
    case "menunggu":
      return {
        title: "Menunggu pembayaran",
        body: `${item}${qty} · dari ${cust}`,
        audience: "both",
        url,
        tag,
      };
    case "dp":
    case "dibayar_sebagian":
      return {
        title: "Pembayaran DP diterima",
        body: `${item}${qty}${input.note ? ` · ${input.note}` : ""}`,
        audience: "both",
        url,
        tag,
      };
    case "lunas":
    case "dibayar":
      return {
        title: "Pembayaran Lunas",
        body: `${item}${qty}${input.note ? ` · ${input.note}` : ""}`,
        audience: "both",
        url,
        tag,
      };
    case "siap":
    case "siap_dikirim":
    case "disiapkan":
      return {
        title: "Barang siap dikirim",
        body: `${item}${qty} untuk ${cust}`,
        audience: "both",
        url,
        tag,
      };
    case "dikirim":
    case "terkirim":
      return {
        title: "Barang telah dikirim",
        body: `${item}${qty} · tujuan ${cust}`,
        audience: "both",
        url,
        tag,
      };
    case "selesai":
      return {
        title: "Pesanan selesai",
        body: `${item}${qty} · ${cust}`,
        audience: "owner",
        url,
        tag,
      };
    case "hutang":
    case "piutang":
      return {
        title: "Status Hutang diperbarui",
        body: `${item}${qty} · ${cust}`,
        audience: "both",
        url,
        tag,
      };
    default:
      return null;
  }
}

export const Route = createFileRoute("/api/public/hooks/order-event-notify")({
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

        const copy = statusCopy(parsed);
        if (!copy) return Response.json({ success: true, skipped: "status_unmapped" });

        // Susun daftar penerima. Actor (yg memicu event) di-exclude supaya
        // pengirim tidak menerima notifikasi atas aksinya sendiri.
        const recipients = new Set<string>();
        if ((copy.audience === "owner" || copy.audience === "both") && parsed.owner_user_id) {
          recipients.add(parsed.owner_user_id);
        }
        if ((copy.audience === "customer" || copy.audience === "both") && parsed.customer_account_user_id) {
          recipients.add(parsed.customer_account_user_id);
        }
        if (parsed.actor_user_id) recipients.delete(parsed.actor_user_id);
        if (recipients.size === 0) {
          return Response.json({ success: true, skipped: "no_recipients" });
        }

        try {
          const { notifyUsers } = await import("@/lib/push.server");
          const result = await notifyUsers({
            userIds: Array.from(recipients),
            payload: {
              title: copy.title,
              body: copy.body,
              url: copy.url,
              tag: copy.tag,
              // H19: samakan dgn enabledKinds di SW; toggle "Notifikasi Order" jadi efektif.
              kind: "order",
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