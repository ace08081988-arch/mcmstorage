import { supabase } from "@/integrations/supabase/client";
import { ensureFreshSession } from "./ensure-session";
import { assertStorageAccess } from "./storage-access";
import type { ImportedContact } from "./device-contacts";

export type { AddressBookRow } from "./address-book.types";
import type { AddressBookRow } from "./address-book.types";

export type ProfileMatch = {
  match_key: string;
  match_kind: "phone" | "email";
  user_id: string;
  display_name: string | null;
};

/**
 * Normalisasi nomor telepon — HARUS identik dengan fungsi database
 * `public.normalize_phone()` yang mengisi kolom `phone_norm`. Kalau beda,
 * pengecekan duplikat di klien lolos tapi database menolak (23505).
 *
 * Semua varian ini menjadi satu nilai yang sama:
 *   0812-3456-7890 · +62 812 3456 7890 · 62 812 3456 7890 ·
 *   0062 812 3456 7890 · (0812) 34567890 · 81234567890
 */
export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, "");
  if (!d) return null;

  if (d.startsWith("00")) d = d.slice(2); // awalan internasional
  else if (d.startsWith("0")) d = "62" + d.slice(1); // nomor lokal Indonesia
  else if (d.startsWith("8")) d = "62" + d; // ditulis tanpa awalan

  while (d.startsWith("6262")) d = d.slice(2); // kode negara terulang
  if (d.startsWith("620")) d = "62" + d.slice(3);

  return d || null;
}

/**
 * Normalisasi email — cermin dari `public.normalize_email()`:
 * huruf kecil, tanpa spasi, label `+tag` dibuang, dan titik pada alamat
 * Gmail diabaikan (googlemail.com disamakan dengan gmail.com).
 */
export function normalizeEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const v = e.trim().replace(/\s/g, "").toLowerCase();
  if (!v) return null;
  const at = v.indexOf("@");
  if (at < 0) return v;
  let local = v.slice(0, at);
  let domain = v.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return local ? `${local}@${domain}` : null;
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
  const name = input.name.trim();
  const phone = input.phone?.trim() || null;
  const email = input.email?.trim() || null;
  // Cegah kontak ganda: cek nomor / email / nama (untuk kontak tanpa nomor).
  const dup = await findDuplicate({
    uid,
    name,
    phone,
    email,
    excludeId: input.id ?? null,
  });
  if (dup) {
    throw new Error(
      `Kontak sudah tersimpan sebagai "${dup.name}". Tidak boleh ada kontak ganda.`,
    );
  }
  const payload = {
    id: input.id,
    user_id: uid,
    name,
    phone,
    email,
    note: input.note?.trim() || null,
    source: "manual" as const,
  };
  const { data, error } = await supabase
    .from("address_book")
    .upsert(payload, { onConflict: "id" })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error("Kontak dengan nomor/email/nama ini sudah tersimpan.");
    }
    throw error;
  }
  return data as AddressBookRow;
}

/** Cari kontak yang sudah ada berdasarkan nomor, email, atau nama. */
export async function findDuplicate(opts: {
  uid: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  excludeId?: string | null;
}): Promise<Pick<AddressBookRow, "id" | "name"> | null> {
  const phoneNorm = normalizePhone(opts.phone);
  const emailNorm = normalizeEmail(opts.email);
  let q = supabase
    .from("address_book")
    .select("id,name")
    .eq("user_id", opts.uid)
    .limit(1);
  if (opts.excludeId) q = q.neq("id", opts.excludeId);
  if (phoneNorm) q = q.eq("phone_norm", phoneNorm);
  else if (emailNorm) q = q.eq("email_norm", emailNorm);
  else q = q.ilike("name", opts.name.trim());
  const { data, error } = await q.maybeSingle();
  if (error) return null;
  return (data as Pick<AddressBookRow, "id" | "name"> | null) ?? null;
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

  // Postgres tidak menerima partial unique index sebagai ON CONFLICT target
  // lewat PostgREST upsert. Lakukan dedup di client: ambil device_contact_id
  // yang sudah ada, lalu insert hanya yang baru dan update yang berubah.
  // M25: gunakan tipe eksplisit `ExistingRow` sebagai pengganti `any`
  // supaya perbandingan field aman dari typo/rename dan hasil `.map()` /
  // `.get()` di bawah tetap typesafe.
  type ExistingRow = {
    id: string;
    device_contact_id: string | null;
    name: string | null;
    phone: string | null;
    email: string | null;
    note: string | null;
  };
  const ids = rows
    .map((r) => r.device_contact_id)
    .filter((v): v is string => !!v);
  const { data: existing, error: exErr } = await supabase
    .from("address_book")
    .select("id,device_contact_id,name,phone,email,note")
    .eq("user_id", uid)
    .in("device_contact_id", ids);
  if (exErr) throw exErr;
  const byId = new Map<string, ExistingRow>();
  for (const r of (existing ?? []) as ExistingRow[]) {
    if (r.device_contact_id) byId.set(r.device_contact_id, r);
  }
  // Dedup lintas-kontak: nomor/email/nama yang sudah ada tidak diimpor ulang.
  const { data: allExisting } = await supabase
    .from("address_book")
    .select("phone_norm,email_norm,name")
    .eq("user_id", uid);
  const seenPhone = new Set<string>();
  const seenEmail = new Set<string>();
  const seenName = new Set<string>();
  for (const r of (allExisting ?? []) as Array<{
    phone_norm: string | null;
    email_norm: string | null;
    name: string | null;
  }>) {
    if (r.phone_norm) seenPhone.add(r.phone_norm);
    if (r.email_norm) seenEmail.add(r.email_norm);
    if (!r.phone_norm && !r.email_norm && r.name) {
      seenName.add(r.name.trim().toLowerCase());
    }
  }
  const toInsert = rows.filter((r) => {
    if (byId.has(r.device_contact_id)) return false;
    const p = normalizePhone(r.phone);
    const e = normalizeEmail(r.email);
    const n = (r.name ?? "").trim().toLowerCase();
    if (p) {
      if (seenPhone.has(p)) return false;
      seenPhone.add(p);
      return true;
    }
    if (e) {
      if (seenEmail.has(e)) return false;
      seenEmail.add(e);
      return true;
    }
    if (!n || seenName.has(n)) return false;
    seenName.add(n);
    return true;
  });
  const toUpdate = rows
    .filter((r) => byId.has(r.device_contact_id))
    .map((r) => ({ existing: byId.get(r.device_contact_id)!, next: r }))
    .filter(({ existing: ex, next }) =>
      ex.name !== next.name ||
      ex.phone !== next.phone ||
      ex.email !== next.email ||
      ex.note !== next.note,
    );

  if (toInsert.length > 0) {
    const { error } = await supabase.from("address_book").insert(toInsert);
    if (error) throw error;
  }
  for (const u of toUpdate) {
    const { error } = await supabase
      .from("address_book")
      .update({
        name: u.next.name,
        phone: u.next.phone,
        email: u.next.email,
        note: u.next.note,
      })
      .eq("id", u.existing.id);
    if (error) throw error;
  }
  return { inserted: toInsert.length, skipped: rows.length - toInsert.length - toUpdate.length };
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
    _phones: phones.length ? phones : undefined,
    _emails: emails.length ? emails : undefined,
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

/** Kunci dedup untuk satu kontak: nomor > email > nama. */
function duplicateKey(r: AddressBookRow): string | null {
  if (r.phone_norm) return `p:${r.phone_norm}`;
  const p = normalizePhone(r.phone);
  if (p) return `p:${p}`;
  if (r.email_norm) return `e:${r.email_norm}`;
  const e = normalizeEmail(r.email);
  if (e) return `e:${e}`;
  const n = r.name.trim().toLowerCase().replace(/\s+/g, " ");
  return n ? `n:${n}` : null;
}

export type DuplicateGroup = {
  key: string;
  reason: "phone" | "email" | "name";
  rows: AddressBookRow[];
};

/** Kelompokkan kontak yang terdeteksi ganda (nomor / email / nama sama). */
export function findDuplicateGroups(rows: AddressBookRow[]): DuplicateGroup[] {
  const map = new Map<string, AddressBookRow[]>();
  for (const r of rows) {
    const k = duplicateKey(r);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, list] of map) {
    if (list.length < 2) continue;
    const reason = key.startsWith("p:") ? "phone" : key.startsWith("e:") ? "email" : "name";
    groups.push({
      key,
      reason,
      rows: [...list].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")),
    });
  }
  return groups.sort((a, b) => b.rows.length - a.rows.length);
}

export type MergeFields = {
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  linked_user_id: string | null;
};

/**
 * Gabungkan beberapa kontak ganda jadi satu. Baris lain dihapus DULU supaya
 * indeks unik (phone_norm/email_norm/name) tidak bentrok saat baris utama
 * diperbarui dengan data pilihan pengguna.
 */
export async function mergeContacts(opts: {
  keepId: string;
  removeIds: string[];
  fields: MergeFields;
}): Promise<AddressBookRow> {
  const removeIds = opts.removeIds.filter((id) => id && id !== opts.keepId);
  if (removeIds.length > 0) {
    const { error } = await supabase.from("address_book").delete().in("id", removeIds);
    if (error) throw error;
  }
  const { data, error } = await supabase
    .from("address_book")
    .update({
      name: opts.fields.name.trim(),
      phone: opts.fields.phone?.trim() || null,
      email: opts.fields.email?.trim() || null,
      note: opts.fields.note?.trim() || null,
      linked_user_id: opts.fields.linked_user_id ?? null,
    })
    .eq("id", opts.keepId)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error("Data gabungan bentrok dengan kontak lain yang sudah tersimpan.");
    }
    throw error;
  }
  return data as AddressBookRow;
}

export async function promoteToCustomer(row: AddressBookRow): Promise<void> {
  const { userId: uid } = await ensureFreshSession();
  await assertStorageAccess(uid);
  const { error } = await supabase.from("customers").insert({
    user_id: uid,
    name: row.name,
    contact: row.phone ?? row.email ?? null,
    account_user_id: row.linked_user_id ?? null,
  });
  if (error) throw error;
}

export async function promoteToSupplier(row: AddressBookRow): Promise<void> {
  const { userId: uid } = await ensureFreshSession();
  await assertStorageAccess(uid);
  const { error } = await supabase.from("suppliers").insert({
    user_id: uid,
    name: row.name,
    contact: row.phone ?? row.email ?? null,
    account_user_id: row.linked_user_id ?? null,
  });
  if (error) throw error;
}