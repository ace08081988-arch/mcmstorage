import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Cek ringan apakah user saat ini memiliki peran `admin` via RPC `has_role`.
 * Aman dipanggil oleh siapa saja (RLS/RPC dijaga di server). Dipakai untuk
 * menyembunyikan menu admin di sidebar; keputusan otoritatif tetap di server
 * function (`requireAdmin`).
 */
export function useIsAdmin(): boolean {
  const { data } = useQuery({
    queryKey: ["auth", "is-admin"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return false;
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: user.user.id,
        _role: "admin",
      });
      if (error) return false;
      return Boolean(data);
    },
    staleTime: 60_000,
  });
  return data === true;
}