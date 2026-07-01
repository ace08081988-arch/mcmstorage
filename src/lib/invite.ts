/**
 * Invite/PIN helper — BBM-style contact exchange lewat kode 8 karakter.
 *
 * PIN disimpan di `profiles.invite_code`. Semua akses lewat RPC
 * `resolve_invite_code` / `add_contact_by_invite_code` (SECURITY DEFINER)
 * supaya orang lain hanya melihat nama + avatar, bukan email/HP.
 */
import { supabase } from "@/integrations/supabase/client";

export type InviteProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  invite_code: string;
  chat_only: boolean;
};

/** Bersihkan input pengguna: buang spasi/tanda hubung, upper-case, potong ke 8+. */
export function normalizeInviteCode(raw: string): string {
  return (raw || "")
    .replace(/[\s\-_]/g, "")
    .toUpperCase()
    .slice(0, 16);
}

export function isLikelyInviteCode(raw: string): boolean {
  const n = normalizeInviteCode(raw);
  return /^[A-Z0-9]{6,16}$/.test(n);
}

/** Format tampilan `ABCD-1234` supaya lebih mudah dibaca/diucapkan. */
export function formatInviteCode(code: string | null | undefined): string {
  const n = normalizeInviteCode(code ?? "");
  if (n.length <= 4) return n;
  return `${n.slice(0, 4)}-${n.slice(4)}`;
}

export function buildInviteUrl(code: string): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://mcmstorage.biz";
  return `${origin}/i/${normalizeInviteCode(code)}`;
}

/** Cari profil dari PIN. Return `null` bila tidak ketemu. */
export async function resolveInviteCode(code: string): Promise<InviteProfile | null> {
  const clean = normalizeInviteCode(code);
  if (!clean) return null;
  const { data, error } = await supabase.rpc("resolve_invite_code", { _code: clean });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : (data as unknown as InviteProfile | null);
  return row ? (row as InviteProfile) : null;
}

export type AddContactResult = {
  contactId: string;
  linkedUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  alreadyExisted: boolean;
};

/** Tambah profil bermilik PIN ke buku alamat pemanggil. */
export async function addContactByInviteCode(code: string): Promise<AddContactResult> {
  const clean = normalizeInviteCode(code);
  if (!clean) throw new Error("Kode undangan kosong.");
  const { data, error } = await supabase.rpc("add_contact_by_invite_code", { _code: clean });
  if (error) {
    // pesan ramah untuk error yang kita lempar dari SQL
    if (/invite_code_not_found/i.test(error.message)) {
      throw new Error("PIN tidak ditemukan. Cek kembali kodenya.");
    }
    if (/unauthorized/i.test(error.message)) {
      throw new Error("Sesi tidak valid — silakan login ulang.");
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : (data as unknown as
    | { contact_id: string; linked_user_id: string; display_name: string | null; avatar_url: string | null; already_existed: boolean }
    | null);
  if (!row) throw new Error("PIN tidak ditemukan.");
  return {
    contactId: row.contact_id,
    linkedUserId: row.linked_user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    alreadyExisted: row.already_existed,
  };
}