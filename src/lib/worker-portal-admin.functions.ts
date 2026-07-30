/**
 * Server-trusted mutations untuk konfigurasi runtime portal pegawai.
 *
 * Latar belakang (M22):
 * - Halaman admin (`/_authenticated/admin/worker-portal`) sebelumnya
 *   memvalidasi role via `supabase.rpc("has_role")` di klien lalu
 *   melakukan UPDATE `app_settings.worker_portal_config` langsung dari
 *   klien. RLS `app_settings` sebetulnya sudah membatasi UPDATE ke
 *   admin, tapi pola tersebut tetap bergantung pada validasi role di
 *   klien untuk keputusan jalur write sensitif.
 * - Server function ini memindahkan enforcement role ke jalur
 *   server-trusted: `requireSupabaseAuth` menegakkan bearer token yang
 *   valid, lalu handler memanggil `has_role` sebagai user tersebut
 *   sebelum menulis. RLS pada `app_settings` tetap menjadi enforcement
 *   terakhir di database.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  WORKER_PORTAL_CONFIG_FIELDS,
  sanitizeWorkerPortalConfig,
  type WorkerPortalConfig,
} from "@/lib/worker-portal-config";

// Bangun skema Zod dari daftar field kanonis agar rentang & tipe selalu
// selaras dengan `WORKER_PORTAL_CONFIG_FIELDS` — tidak ada duplikasi
// batas min/max antara UI admin dan server.
const workerPortalConfigSchema = (() => {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of WORKER_PORTAL_CONFIG_FIELDS) {
    shape[f.key] = z
      .number()
      .finite()
      .int()
      .min(f.min)
      .max(f.max);
  }
  return z
    .object(shape)
    .refine(
      (v) => (v.lagThresholdSec as number) < (v.staleThresholdSec as number),
      { message: "lagThresholdSec harus < staleThresholdSec", path: ["lagThresholdSec"] },
    )
    .refine(
      (v) => (v.staleCooldownBaseMs as number) <= (v.staleCooldownMaxMs as number),
      { message: "staleCooldownBaseMs harus <= staleCooldownMaxMs", path: ["staleCooldownBaseMs"] },
    );
})();

export const saveWorkerPortalConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => workerPortalConfigSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; config: WorkerPortalConfig }> => {
    // Enforcement role di server (bukan di klien).
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc(
      "has_role",
      { _user_id: context.userId, _role: "admin" },
    );
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden");

    // Belt-and-braces: sanitasi kembali (mis. bila ada field masa depan
    // yang belum dikenal skema; sanitizer mengabaikan yang tidak dikenal
    // dan mengunci invariant antar-field).
    const clean = sanitizeWorkerPortalConfig(data as Partial<WorkerPortalConfig>);

    const { error } = await context.supabase
      .from("app_settings")
      .update({ worker_portal_config: clean })
      .eq("id", true);
    if (error) throw new Error(error.message);

    return { ok: true, config: clean as WorkerPortalConfig };
  });