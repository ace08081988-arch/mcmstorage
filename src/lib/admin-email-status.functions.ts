import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type UserEmailStatus = {
  found: boolean;
  userId: string | null;
  email: string | null;
  emailConfirmedAt: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  isSuppressed: boolean;
  suppressionReason: string | null;
  logs: Array<{
    id: string;
    message_id: string | null;
    template_name: string | null;
    recipient_email: string;
    status: string;
    error_message: string | null;
    created_at: string;
  }>;
};

/**
 * Admin-only: cari user auth berdasarkan email dan kembalikan status
 * verifikasi + log pengiriman email untuk alamat tersebut.
 */
export const adminGetUserEmailStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().trim().toLowerCase().email(),
        logLimit: z.number().int().min(1).max(500).default(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<UserEmailStatus> => {
    const isAdmin = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin.data) throw new Error("Forbidden");

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    // Cari user auth via listUsers dengan filter email (perPage 200 cukup
    // aman untuk pencocokan exact karena kita filter di klien-server).
    let userFound: {
      id: string;
      email: string | null;
      email_confirmed_at: string | null;
      created_at: string;
      last_sign_in_at: string | null;
      banned_until: string | null;
    } | null = null;

    // Supabase Admin API tidak punya filter email langsung. Loop sampai
    // halaman terakhir (halaman berikutnya mengembalikan <perPage rows)
    // dengan safety cap besar agar pencarian tidak berhenti di user ke-1001.
    const PER_PAGE = 200;
    const MAX_PAGES = 500; // 100.000 user — jauh di atas kebutuhan shop kecil
    for (let page = 1; page <= MAX_PAGES && !userFound; page += 1) {
      const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: PER_PAGE,
      });
      if (error) throw new Error(error.message);
      const match = list.users.find(
        (u) => (u.email ?? "").toLowerCase() === data.email,
      );
      if (match) {
        userFound = {
          id: match.id,
          email: match.email ?? null,
          email_confirmed_at: match.email_confirmed_at ?? null,
          created_at: match.created_at,
          last_sign_in_at: match.last_sign_in_at ?? null,
          banned_until: (match as { banned_until?: string }).banned_until ?? null,
        };
      }
      if (list.users.length < PER_PAGE) break;
    }

    // Suppressed?
    const { data: suppressed } = await supabaseAdmin
      .from("suppressed_emails")
      .select("reason")
      .eq("email", data.email)
      .maybeSingle();

    // Log — dedup by message_id, latest per email.
    const { data: rawLogs, error: logErr } = await supabaseAdmin
      .from("email_send_log")
      .select("id, message_id, template_name, recipient_email, status, error_message, created_at")
      .eq("recipient_email", data.email)
      .order("created_at", { ascending: false })
      .limit(data.logLimit);
    if (logErr) throw new Error(logErr.message);

    const seen = new Set<string>();
    const dedup: UserEmailStatus["logs"] = [];
    for (const row of rawLogs ?? []) {
      const key = row.message_id ?? `__row_${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push({
        id: String(row.id),
        message_id: row.message_id ?? null,
        template_name: row.template_name ?? null,
        recipient_email: row.recipient_email,
        status: row.status,
        error_message: row.error_message ?? null,
        created_at: row.created_at,
      });
    }

    return {
      found: !!userFound,
      userId: userFound?.id ?? null,
      email: userFound?.email ?? (data.email as string),
      emailConfirmedAt: userFound?.email_confirmed_at ?? null,
      createdAt: userFound?.created_at ?? null,
      lastSignInAt: userFound?.last_sign_in_at ?? null,
      bannedUntil: userFound?.banned_until ?? null,
      isSuppressed: !!suppressed,
      suppressionReason: suppressed?.reason ?? null,
      logs: dedup,
    };
  });
