import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/address-book";

/**
 * Alias kontak per peer (linked_user_id atau phone_norm/email_norm) yang
 * tersimpan di `address_book`. Nama yang diedit di chat otomatis tersinkron.
 */
export type PeerKey = {
  peerUserId?: string | null;
  peerPhone?: string | null;
  peerEmail?: string | null;
};

export type PeerAliasRow = {
  id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  linked_user_id: string | null;
  source: "device" | "manual" | "app" | null;
};

function peerKeyToQueryKey(k: PeerKey) {
  return [
    "contact-alias",
    k.peerUserId ?? "",
    normalizePhone(k.peerPhone ?? "") ?? "",
    (k.peerEmail ?? "").toLowerCase().trim(),
  ];
}

async function findAliasRow(k: PeerKey): Promise<PeerAliasRow | null> {
  const phoneNorm = normalizePhone(k.peerPhone ?? "");
  const emailNorm = (k.peerEmail ?? "").toLowerCase().trim() || null;
  // 1) Prefer match by linked_user_id (paling akurat).
  if (k.peerUserId) {
    const { data } = await supabase
      .from("address_book")
      .select("id,name,phone,email,linked_user_id,source")
      .eq("linked_user_id", k.peerUserId)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (data && data[0]) return data[0] as PeerAliasRow;
  }
  // 2) Fallback by phone_norm.
  if (phoneNorm) {
    const { data } = await supabase
      .from("address_book")
      .select("id,name,phone,email,linked_user_id,source")
      .eq("phone_norm", phoneNorm)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (data && data[0]) return data[0] as PeerAliasRow;
  }
  // 3) Fallback by email_norm.
  if (emailNorm) {
    const { data } = await supabase
      .from("address_book")
      .select("id,name,phone,email,linked_user_id,source")
      .eq("email_norm", emailNorm)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (data && data[0]) return data[0] as PeerAliasRow;
  }
  return null;
}

export function usePeerAlias(k: PeerKey) {
  return useQuery({
    queryKey: peerKeyToQueryKey(k),
    enabled: !!(k.peerUserId || k.peerPhone || k.peerEmail),
    queryFn: () => findAliasRow(k),
    staleTime: 30_000,
  });
}

/** Upsert nama kontak ke address_book. Membuat baris baru bila belum ada. */
export async function savePeerAlias(
  k: PeerKey,
  name: string,
): Promise<PeerAliasRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Nama tidak boleh kosong.");
  if (trimmed.length > 100) throw new Error("Nama maksimum 100 karakter.");
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Tidak ada sesi pengguna.");

  const existing = await findAliasRow(k);
  if (existing && existing.id) {
    const { data, error } = await supabase
      .from("address_book")
      .update({
        name: trimmed,
        // promosikan source manual agar tidak ditimpa oleh sinkronisasi device.
        source: existing.source === "device" ? "manual" : (existing.source ?? "manual"),
        // pastikan linked_user_id ikut tersinkron bila baru diketahui dari chat.
        ...(k.peerUserId && !existing.linked_user_id ? { linked_user_id: k.peerUserId } : {}),
      })
      .eq("id", existing.id)
      .select("id,name,phone,email,linked_user_id,source")
      .single();
    if (error) throw error;
    return data as PeerAliasRow;
  }

  const phone = k.peerPhone?.trim() || null;
  const email = k.peerEmail?.trim() || null;
  const { data, error } = await supabase
    .from("address_book")
    .insert({
      user_id: uid,
      name: trimmed,
      phone,
      email,
      linked_user_id: k.peerUserId ?? null,
      source: "manual",
    })
    .select("id,name,phone,email,linked_user_id,source")
    .single();
  if (error) throw error;
  return data as PeerAliasRow;
}

export function useSavePeerAlias(k: PeerKey) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => savePeerAlias(k, name),
    onSuccess: (row) => {
      qc.setQueryData(peerKeyToQueryKey(k), row);
      // Address book list page memakai key ini.
      qc.invalidateQueries({ queryKey: ["address-book"] });
    },
  });
}