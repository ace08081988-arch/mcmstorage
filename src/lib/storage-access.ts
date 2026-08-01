import { supabase } from "@/integrations/supabase/client";

/**
 * Akun "chat-only" (profiles.chat_only = true) diblokir oleh RLS pada tabel
 * MCM Storage:
 *   USING/WITH CHECK: user_id = auth.uid() AND NOT is_chat_only(auth.uid())
 *
 * Tanpa pre-check, form tambah barang/pelanggan tetap mengirim INSERT dan
 * gagal dengan 42501 ("new row violates row-level security policy") — dead
 * end tanpa penjelasan. Helper ini memeriksa status akun sekali (cache
 * in-memory) lalu melempar pesan yang mengarahkan ke upgrade.
 */
const CACHE_MS = 60_000;
let cache: { uid: string; chatOnly: boolean; at: number } | null = null;

export const STORAGE_UPGRADE_MESSAGE =
  "Akun ini masih mode MCM Chat, jadi belum bisa menyimpan data Gudang/Pelanggan. Buka Profil → “Upgrade ke MCM Storage” lalu coba lagi.";

export function clearStorageAccessCache() {
  cache = null;
}

/** true bila akun saat ini chat-only. Gagal-terbuka (false) bila cek error. */
export async function isChatOnlyAccount(uid: string): Promise<boolean> {
  const now = Date.now();
  if (cache && cache.uid === uid && now - cache.at < CACHE_MS) return cache.chatOnly;
  const { data, error } = await supabase
    .from("profiles")
    .select("chat_only")
    .eq("id", uid)
    .maybeSingle();
  if (error) return false;
  const chatOnly = Boolean(data?.chat_only);
  cache = { uid, chatOnly, at: now };
  return chatOnly;
}

/** Lempar Error ramah bila akun chat-only tidak boleh menulis data Storage. */
export async function assertStorageAccess(uid: string): Promise<void> {
  if (await isChatOnlyAccount(uid)) throw new Error(STORAGE_UPGRADE_MESSAGE);
}
