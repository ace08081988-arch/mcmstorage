import { supabase } from "@/integrations/supabase/client";

/**
 * Audit log untuk flag `send=1` (auto-Kirim dari beranda).
 *
 * Alur:
 *   1. Efek autoSend membangun `activeNow` dan MEMANGGIL `logAutoSendProposed`
 *      persis sebelum modal konfirmasi dibuka. Hasilnya (`id`) disimpan pada
 *      state modal supaya bisa di-finalize.
 *   2. Terminal outcomes tanpa modal (`mismatched`, `empty`) juga dicatat via
 *      `logAutoSendTerminal` — supaya jejak audit tidak bolong.
 *   3. Modal `Batal` / dialog pembayaran ditutup tanpa kirim → finalize
 *      `cancelled`.
 *   4. `onSent` di SendEcerPrepsDialog → finalize `confirmed`. Baris ini
 *      juga jadi sumber ringkasan yang ditampilkan di banner Riwayat.
 */

export type AutoSendOutcome =
  | "proposed"
  | "confirmed"
  | "cancelled"
  | "mismatched"
  | "empty";

export type AutoSendAuditRow = {
  id: string;
  user_id: string;
  title_id: string;
  warehouse_item_id: string | null;
  prep_ids: string[];
  prep_count: number;
  total_grams: number;
  unit_label: string | null;
  outcome: AutoSendOutcome;
  note: string | null;
  created_at: string;
  finalized_at: string | null;
};

export type AutoSendProposal = {
  titleId: string;
  warehouseItemId: string | null;
  prepIds: string[];
  prepCount: number;
  totalGrams: number;
  unitLabel: string | null;
  note?: string | null;
};

/** Catat baris awal `proposed` — kembalikan id untuk finalize. */
export async function logAutoSendProposed(
  p: AutoSendProposal,
): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("auto_send_audit")
    .insert({
      user_id: userId,
      title_id: p.titleId,
      warehouse_item_id: p.warehouseItemId,
      prep_ids: p.prepIds,
      prep_count: p.prepCount,
      total_grams: p.totalGrams,
      unit_label: p.unitLabel,
      outcome: "proposed" as AutoSendOutcome,
      note: p.note ?? null,
    })
    .select("id")
    .single();
  if (error) return null;
  return data?.id ?? null;
}

/** Baris terminal tanpa fase `proposed` (mismatched/empty). */
export async function logAutoSendTerminal(
  p: AutoSendProposal & { outcome: Exclude<AutoSendOutcome, "proposed"> },
): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;
  await supabase.from("auto_send_audit").insert({
    user_id: userId,
    title_id: p.titleId,
    warehouse_item_id: p.warehouseItemId,
    prep_ids: p.prepIds,
    prep_count: p.prepCount,
    total_grams: p.totalGrams,
    unit_label: p.unitLabel,
    outcome: p.outcome,
    note: p.note ?? null,
    finalized_at: new Date().toISOString(),
  });
}

/** Finalize baris `proposed` menjadi outcome terminal. */
export async function finalizeAutoSend(
  id: string | null | undefined,
  outcome: Exclude<AutoSendOutcome, "proposed">,
  note?: string,
): Promise<AutoSendAuditRow | null> {
  if (!id) return null;
  const { data, error } = await supabase
    .from("auto_send_audit")
    .update({
      outcome,
      note: note ?? null,
      finalized_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return null;
  return (data ?? null) as AutoSendAuditRow | null;
}