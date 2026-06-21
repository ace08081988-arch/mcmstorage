import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MyProfile = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
};

export const MY_PROFILE_KEY = ["my-profile"] as const;

export async function getMyProfile(): Promise<MyProfile | null> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, email, phone")
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
    };
  }
  return data as MyProfile;
}

export async function updateMyProfile(input: {
  display_name?: string | null;
  phone?: string | null;
}): Promise<MyProfile> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) throw new Error("Anda belum masuk.");

  // Upsert agar bekerja walau baris belum sempat dibuat oleh trigger.
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        email: user.email ?? null,
        display_name: input.display_name ?? null,
        phone: input.phone ?? null,
      },
      { onConflict: "id" },
    )
    .select("id, display_name, email, phone")
    .single();
  if (error) throw error;
  return data as MyProfile;
}

export function useMyProfile() {
  return useQuery({
    queryKey: MY_PROFILE_KEY,
    queryFn: getMyProfile,
    staleTime: 60_000,
  });
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