import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type MyProfile = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  country_code: string;
  language: string;
  currency: string;
  date_format: string;
  avatar_url: string | null;
  invite_code: string | null;
};

const PROFILE_COLS: string =
  "id, display_name, email, phone, country_code, language, currency, date_format, avatar_url, invite_code";

const DEFAULT_PREFS = {
  country_code: "ID",
  language: "id",
  currency: "IDR",
  date_format: "DD/MM/YYYY",
} as const;

export const MY_PROFILE_KEY = ["my-profile"] as const;

export async function getMyProfile(): Promise<MyProfile | null> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLS)
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;

  // Trigger DB sudah membuat baris saat signup; fallback bila belum sempat ada.
  if (!data) {
    return {
      id: user.id,
      display_name:
        (user.user_metadata?.display_name as string | undefined) ??
        (user.user_metadata?.full_name as string | undefined) ??
        user.email?.split("@")[0] ??
        null,
      email: user.email ?? null,
      phone: user.phone ?? null,
      avatar_url: null,
      invite_code: null,
      ...DEFAULT_PREFS,
    };
  }
  return { ...DEFAULT_PREFS, ...((data as unknown) as Partial<MyProfile> & { id: string }) } as MyProfile;
}

export async function updateMyProfile(input: {
  display_name?: string | null;
  phone?: string | null;
  country_code?: string;
  language?: string;
  currency?: string;
  date_format?: string;
  avatar_url?: string | null;
}): Promise<MyProfile> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) throw new Error("Anda belum masuk.");

  // Upsert agar bekerja walau baris belum sempat dibuat oleh trigger.
  const payload: Record<string, unknown> = {
    id: user.id,
    email: user.email ?? null,
    display_name: input.display_name ?? null,
    phone: input.phone ?? null,
    ...(input.country_code ? { country_code: input.country_code } : {}),
    ...(input.language ? { language: input.language } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.date_format ? { date_format: input.date_format } : {}),
    ...(input.avatar_url !== undefined ? { avatar_url: input.avatar_url } : {}),
  };

  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload as never, { onConflict: "id" })
    .select(PROFILE_COLS)
    .single();
  if (error) throw error;
  return { ...DEFAULT_PREFS, ...((data as unknown) as Partial<MyProfile> & { id: string }) } as MyProfile;
}

/** Upload avatar baru ke storage bucket `avatars/{userId}/avatar-...`, lalu kembalikan path-nya. */
export async function uploadMyAvatar(file: File): Promise<string> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) throw new Error("Anda belum masuk.");
  if (!file.type.startsWith("image/")) throw new Error("File harus berupa gambar.");
  if (file.size > 3 * 1024 * 1024) throw new Error("Ukuran maksimum 3 MB.");

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${user.id}/avatar-${Date.now()}.${ext || "jpg"}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
  if (error) throw error;
  return path;
}

/** Hapus avatar saat ini (jika ada) dari storage. */
export async function removeAvatarObject(path: string | null | undefined): Promise<void> {
  if (!path) return;
  await supabase.storage.from("avatars").remove([path]);
}

/** Ambil signed URL untuk menampilkan avatar (bucket privat). */
export function useAvatarSignedUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ["avatar-url", path],
    enabled: !!path,
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      if (!path) return null;
      const { data, error } = await supabase.storage
        .from("avatars")
        .createSignedUrl(path, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export function useMyProfile() {
  return useQuery({
    queryKey: MY_PROFILE_KEY,
    queryFn: getMyProfile,
    staleTime: 60_000,
  });
}

/**
 * Berlangganan perubahan realtime pada baris `profiles` milik user saat ini.
 * Setiap UPDATE (mis. ganti nama/avatar dari tab lain atau perangkat lain)
 * langsung meng-invalidate cache profil sehingga UI ikut refresh tanpa reload.
 *
 * Dipakai berbarengan dengan `useMyProfile()` — sengaja dipisah supaya hook
 * dasar tetap murni (bisa dipakai di banyak tempat tanpa membuka channel
 * berulang), sementara halaman yang menampilkan avatar/nama besar (Profil
 * Chat, Header) memasang subscription.
 */
export function useMyProfileRealtime(): void {
  const qc = useQueryClient();
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`profile:${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "profiles", filter: `id=eq.${uid}` },
          () => {
            qc.invalidateQueries({ queryKey: MY_PROFILE_KEY });
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "address_book", filter: `user_id=eq.${uid}` },
          () => {
            // Buku alamat memengaruhi alias nama kontak yang ditampilkan.
            qc.invalidateQueries({ queryKey: ["address-book"] });
            qc.invalidateQueries({ queryKey: ["contact-alias"] });
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);
}

export function useUpdateMyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateMyProfile,
    onSuccess: (data) => {
      qc.setQueryData(MY_PROFILE_KEY, data);
    },
  });
}

/** Format kontak untuk dipakai di pesan WhatsApp/label, mis. "Andi · 0812..." */
export function formatProfileContact(p: MyProfile | null | undefined): string {
  if (!p) return "";
  const parts = [p.display_name, p.phone].filter(Boolean) as string[];
  return parts.join(" · ");
}