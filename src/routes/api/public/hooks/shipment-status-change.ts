import * as React from "react";
import { render } from "@react-email/render";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TEMPLATES } from "@/lib/email-templates/registry";

// Route dipanggil oleh trigger DB via pg_net. Autentikasi: header
// x-hook-secret harus cocok dengan env SHIPMENT_HOOK_SECRET.
const SITE_NAME = "mcmstorage";
const SENDER_DOMAIN = "notify.mcmstorage.biz";
const FROM_DOMAIN = "notify.mcmstorage.biz";
const TEMPLATE_NAME = "shipment-status-update";

const payloadSchema = z.object({
  source: z.enum(["ready_packages", "order_requests"]),
  row_id: z.string().uuid(),
  status_key: z.enum(["disiapkan", "dikirim", "selesai"]),
  customer_id: z.string().uuid().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
  item_name: z.string().nullable().optional(),
  qty: z.union([z.string(), z.number()]).nullable().optional(),
  note: z.string().nullable().optional(),
});

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  return digits;
}

async function resolveEmail(
  supabase: SupabaseClient,
  args: {
    customerId?: string | null;
    customerPhone?: string | null;
  },
): Promise<string | null> {
  // 1) customer_id -> customers.account_user_id -> auth.users.email
  if (args.customerId) {
    const { data: cust } = await supabase
      .from("customers")
      .select("account_user_id, contact")
      .eq("id", args.customerId)
      .maybeSingle();
    const custRow = cust as { account_user_id?: string | null; contact?: string | null } | null;
    if (custRow?.account_user_id) {
      const { data: authUser } = await supabase.auth.admin.getUserById(custRow.account_user_id);
      const email = authUser?.user?.email;
      if (email) return email;
    }
    // Cocokkan contact ke address_book.phone_norm
    const custPhoneNorm = normPhone(custRow?.contact ?? null);
    if (custPhoneNorm) {
      const { data: ab } = await supabase
        .from("address_book")
        .select("email")
        .eq("phone_norm", custPhoneNorm)
        .not("email", "is", null)
        .limit(1)
        .maybeSingle();
      const abRow = ab as { email?: string | null } | null;
      if (abRow?.email) return abRow.email;
    }
  }
  // 2) phone langsung dari payload (mis. ready_packages.sent_to_phone)
  const phoneNorm = normPhone(args.customerPhone ?? null);
  if (phoneNorm) {
    const { data: ab } = await supabase
      .from("address_book")
      .select("email")
      .eq("phone_norm", phoneNorm)
      .not("email", "is", null)
      .limit(1)
      .maybeSingle();
    const abRow = ab as { email?: string | null } | null;
    if (abRow?.email) return abRow.email;
  }
  return null;
}

export const Route = createFileRoute("/api/public/hooks/shipment-status-change")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const hookSecret = process.env.SHIPMENT_HOOK_SECRET;
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!hookSecret || !supabaseUrl || !supabaseServiceKey) {
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }
        const provided = request.headers.get("x-hook-secret") ?? "";
        // constant-time-ish compare
        if (provided.length !== hookSecret.length || provided !== hookSecret) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let parsed;
        try {
          const body = await request.json();
          parsed = payloadSchema.parse(body);
        } catch (err) {
          return Response.json(
            { error: "Invalid payload", detail: err instanceof Error ? err.message : String(err) },
            { status: 400 },
          );
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const email = await resolveEmail(supabase, {
          customerId: parsed.customer_id ?? null,
          customerPhone: parsed.customer_phone ?? null,
        });
        if (!email) {
          console.info("[shipment-hook] skip (no email)", {
            source: parsed.source,
            row_id: parsed.row_id,
            status_key: parsed.status_key,
          });
          return Response.json({ success: false, reason: "no_email_for_customer" });
        }

        // Idempotency: satu email per (row_id, status_key)
        const idempotencyKey = `shipment-${parsed.source}-${parsed.row_id}-${parsed.status_key}`;
        const messageId = crypto.randomUUID();

        // Check suppression
        const { data: suppressed } = await supabase
          .from("suppressed_emails")
          .select("id")
          .eq("email", email.toLowerCase())
          .maybeSingle();
        if (suppressed) {
          await supabase.from("email_send_log").insert({
            message_id: messageId,
            template_name: TEMPLATE_NAME,
            recipient_email: email,
            status: "suppressed",
          });
          return Response.json({ success: false, reason: "email_suppressed" });
        }

        // Idempotency ditegakkan hilir oleh queue processor via idempotency_key
        // pada payload; kalau row disimpan berulang kali dengan status yang sama
        // trigger tidak fire (WHEN NEW.status IS DISTINCT FROM OLD.status).

        // Unsubscribe token
        const normalizedEmail = email.toLowerCase();
        let unsubscribeToken: string;
        const { data: existingTok } = await supabase
          .from("email_unsubscribe_tokens")
          .select("token, used_at")
          .eq("email", normalizedEmail)
          .maybeSingle();
        const existingTokRow = existingTok as { token?: string; used_at?: string | null } | null;
        if (existingTokRow?.token && !existingTokRow.used_at) {
          unsubscribeToken = existingTokRow.token;
        } else {
          unsubscribeToken = generateToken();
          await supabase
            .from("email_unsubscribe_tokens")
            .upsert(
              { token: unsubscribeToken, email: normalizedEmail },
              { onConflict: "email", ignoreDuplicates: true },
            );
          const { data: stored } = await supabase
            .from("email_unsubscribe_tokens")
            .select("token")
            .eq("email", normalizedEmail)
            .maybeSingle();
          const storedRow = stored as { token?: string } | null;
          if (storedRow?.token) unsubscribeToken = storedRow.token;
        }

        // Render template
        const entry = TEMPLATES[TEMPLATE_NAME];
        if (!entry) {
          return Response.json({ error: "Template missing" }, { status: 500 });
        }
        const templateData = {
          customerName: parsed.customer_name ?? undefined,
          itemName: parsed.item_name ?? undefined,
          qty: parsed.qty ?? undefined,
          statusKey: parsed.status_key,
          referenceNote: parsed.note ?? undefined,
          storeName: SITE_NAME,
        };
        const element = React.createElement(entry.component, templateData);
        const html = await render(element);
        const plainText = await render(element, { plainText: true });
        const subject =
          typeof entry.subject === "function" ? entry.subject(templateData) : entry.subject;

        await supabase.from("email_send_log").insert({
          message_id: messageId,
          template_name: TEMPLATE_NAME,
          recipient_email: email,
          status: "pending",
          metadata: { idempotency_key: idempotencyKey, source: parsed.source, row_id: parsed.row_id },
        });

        const { error: enqueueError } = await supabase.rpc("enqueue_email", {
          queue_name: "transactional_emails",
          payload: {
            message_id: messageId,
            to: email,
            from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
            sender_domain: SENDER_DOMAIN,
            subject,
            html,
            text: plainText,
            purpose: "transactional",
            label: TEMPLATE_NAME,
            idempotency_key: idempotencyKey,
            unsubscribe_token: unsubscribeToken,
            queued_at: new Date().toISOString(),
          },
        });
        if (enqueueError) {
          await supabase.from("email_send_log").insert({
            message_id: messageId,
            template_name: TEMPLATE_NAME,
            recipient_email: email,
            status: "failed",
            error_message: "Failed to enqueue email",
          });
          return Response.json({ error: "Failed to enqueue" }, { status: 500 });
        }

        return Response.json({ success: true, queued: true });
      },
    },
  },
});
