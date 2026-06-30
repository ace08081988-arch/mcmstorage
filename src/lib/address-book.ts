import { supabase } from "@/integrations/supabase/client";
import type { ImportedContact } from "./device-contacts";

export type AddressBookRow = {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  phone_norm: string | null;
  email: string | null;
  email_norm: string | null;
  source: "device" | "manual" | "app";
  device_contact_id: string | null;
  linked_user_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileMatch = {
  match_key: string;
  match_kind: "phone" | "email";
  user_id: string;
  display_name: string | null;
};

export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const t = p.trim();
  if (!t) return null;
  const digits = t.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits.replace(/[^\d]/g, "");
  const onlyDigits = digits.replace(/[^\d]/g, "");
  if (onlyDigits.startsWith("0")) return "62" + onlyDigits.slice(1);
  return onlyDigits;
}

export async function fetchAddressBook(): Promise<AddressBookRow[]> {
  const { data, error } = await supabase
    .from("address_book")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AddressBookRow[];
}

export async function deleteAddressBookEntry(id: string): Promise<void> {
  const { error } = await supabase.from("address_book").delete().eq("id", id);
  if (error) throw error;
}

export async function upsertManualEntry(input: {
  id?: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  note?: string | null;
}): Promise<AddressBookRow> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Tidak ada sesi pengguna.");
  const payload = {
    id: input.id,
    user_id: uid,
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    note: input.note?.trim() || null,
    source: "manual" as const,
  };
  const { data, error } = await supabase
    .from("address_book")
    .upsert(payload, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as AddressBookRow;
}

/** Import device contacts: one row per (contact x phone-or-email), dedup via device_contact_id. */
export async function importDeviceContacts(
  contacts: ImportedContact[],
): Promise<{ inserted: number; skipped: number }> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Tidak ada sesi pengguna.");

  // Each device contact becomes ONE row using its primary phone/email.
  // Multiple phones/emails are concatenated in `note`.
  const rows = contacts.map((c) => {
    const phone = c.phones[0] ?? null;
    const email = c.emails[0] ?? null;
    const extraPhones = c.phones.slice(1);
    const extraEmails = c.emails.slice(1);
    const note =
      [
        extraPhones.length ? `Tel lain: ${extraPhones.join(", ")}` : null,
        extraEmails.length ? `Email lain: ${extraEmails.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null;
    return {
      user_id: uid,
      name: c.name,
      phone,
      email,
      note,
      source: "device" as const,
      device_contact_id: c.device_contact_id,
    };
  });

  if (rows.length === 0) return { inserted: 0, skipped: 0 };

  // Use upsert on (user_id, device_contact_id). The DB unique index uses a
  // partial filter; pg accepts the index name via onConflict columns.
  const { error, count } = await supabase
    .from("address_book")
    .upsert(rows, {
      onConflict: "user_id,device_contact_id",
      ignoreDuplicates: false,
      count: "exact",
    })
    .select("id", { count: "exact" });
  if (error) throw error;
  return { inserted: count ?? rows.length, skipped: 0 };
}

export async function matchAgainstProfiles(rows: AddressBookRow[]): Promise<ProfileMatch[]> {
  const phones = Array.from(
    new Set(rows.map((r) => r.phone_norm).filter((v): v is string => !!v)),
  );
  const emails = Array.from(
    new Set(rows.map((r) => r.email_norm).filter((v): v is string => !!v)),
  );
  if (phones.length === 0 && emails.length === 0) return [];
  const { data, error } = await supabase.rpc("match_address_book_profiles", {
    _phones: phones.length ? phones : null,
    _emails: emails.length ? emails : null,
  });
  if (error) throw error;
  return (data ?? []) as ProfileMatch[];
}

/** Update linked_user_id rows based on a match table. */
export async function applyProfileMatches(
  rows: AddressBookRow[],
  matches: ProfileMatch[],
): Promise<number> {
  const phoneMap = new Map<string, string>();
  const emailMap = new Map<string, string>();
  for (const m of matches) {
    if (m.match_kind === "phone") phoneMap.set(m.match_key, m.user_id);
    else emailMap.set(m.match_key, m.user_id);
  }
  const updates: Array<{ id: string; linked_user_id: string }> = [];
  for (const r of rows) {
    const linked =
      (r.phone_norm && phoneMap.get(r.phone_norm)) ||
      (r.email_norm && emailMap.get(r.email_norm)) ||
      null;
    if (linked && linked !== r.linked_user_id) {
      updates.push({ id: r.id, linked_user_id: linked });
    }
  }
  if (updates.length === 0) return 0;
  let ok = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from("address_book")
      .update({ linked_user_id: u.linked_user_id })
      .eq("id", u.id);
    if (!error) ok++;
  }
  return ok;
}

export async function promoteToCustomer(row: AddressBookRow): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Tidak ada sesi pengguna.");
  const { error } = await supabase.from("customers").insert({
    user_id: uid,
    name: row.name,
    contact: row.phone ?? row.email ?? null,
    account_user_id: row.linked_user_id ?? null,
  });
  if (error) throw error;
}

export async function promoteToSupplier(row: AddressBookRow): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Tidak ada sesi pengguna.");
  const { error } = await supabase.from("suppliers").insert({
    user_id: uid,
    name: row.name,
    contact: row.phone ?? row.email ?? null,
    account_user_id: row.linked_user_id ?? null,
  });
  if (error) throw error;
}