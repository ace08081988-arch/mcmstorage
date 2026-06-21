import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
};

const PROFILE_COLS = "id, display_name, email, phone, country_code, language, currency, date_format";

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
      ...DEFAULT_PREFS,
    };
  }
  return { ...DEFAULT_PREFS, ...(data as Partial<MyProfile> & { id: string }) } as MyProfile;
}

export async function updateMyProfile(input: {
  display_name?: string | null;
  phone?: string | null;
  country_code?: string;
  language?: string;
  currency?: string;
  date_format?: string;
}): Promise<MyProfile> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) throw new Error("Anda belum masuk.");

  // Upsert agar bekerja walau baris belum sempat dibuat oleh trigger.
  const payload = {
    id: user.id,
    email: user.email ?? null,
    display_name: input.display_name ?? null,
    phone: input.phone ?? null,
    ...(input.country_code ? { country_code: input.country_code } : {}),
    ...(input.language ? { language: input.language } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.date_format ? { date_format: input.date_format } : {}),
  };

  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "id" })
    .select(PROFILE_COLS)
    .single();
  if (error) throw error;
  return { ...DEFAULT_PREFS, ...(data as Partial<MyProfile> & { id: string }) } as MyProfile;
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