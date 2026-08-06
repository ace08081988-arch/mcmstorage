import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Kind yang dipakai untuk metrik kontak/pelanggan di portal_error_events. */
export const CONTACT_EVENT_KINDS = [
  "party_write_failure",
  "address_book_duplicate_block",
] as const;
export type ContactEventKind = (typeof CONTACT_EVENT_KINDS)[number];

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Menyimpan satu event telemetri kontak. Dipanggil fire-and-forget dari klien;
 * kegagalan pencatatan tidak boleh mengubah alur UI.
 */
export const logContactEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const d = (data ?? {}) as Record<string, unknown>;
    const kind = str(d.kind, 40) ?? "";
    if (!(CONTACT_EVENT_KINDS as readonly string[]).includes(kind)) {
      throw new Error("kind tidak dikenal");
    }
    return {
      kind: kind as ContactEventKind,
      code: str(d.code, 60),
      status: str(d.status, 200),
      route: str(d.route, 200),
    };
  })
  .handler(async ({ context, data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("portal_error_events").insert({
        kind: data.kind,
        code: data.code,
        status: data.status,
        route: data.route,
        // Tidak menyimpan identitas mentah: cukup hash pendek dari user id.
        token_hash: context.userId ? context.userId.slice(0, 8) : null,
      });
    } catch {
      // abaikan: telemetri bersifat best-effort
    }
    return { ok: true as const };
  });
