import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Cek ringan apakah user saat ini memiliki peran `admin` via RPC `has_role`.
 * Aman dipanggil oleh siapa saja (RLS/RPC dijaga di server). Dipakai untuk
 * menyembunyikan menu admin di sidebar; keputusan otoritatif tetap di server
 * function (`requireAdmin`).
 */
export function useAdminStatus() {
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUserId(data.user?.id ?? null);
      setReady(true);
    });
    // Jangan reset userId hanya karena event auth mengirim session sementara
    // `null` (kondisi umum saat TOKEN_REFRESHED / INITIAL_SESSION / reconnect
    // WebView di Android). Reset hanya pada SIGNED_OUT/USER_DELETED — jika
    // dilakukan pada tiap event, komponen yang bergantung `isAdmin` (mis.
    // halaman /tugas-baru) sempat swap ke layar "Akses ditolak" dan
    // unmount, sehingga input yang sedang diketik user hilang.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const nextId = session?.user?.id ?? null;
      if (event === "SIGNED_OUT") {
        setUserId(null);
      } else if (nextId) {
        setUserId((prev) => (prev === nextId ? prev : nextId));
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const query = useQuery({
    queryKey: ["auth", "is-admin", userId],
    enabled: ready && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: userId as string,
        _role: "admin",
      });
      if (error) return false;
      return Boolean(data);
    },
    staleTime: 60_000,
    retry: false,
  });
  return {
    isAdmin: ready && !!userId && query.data === true,
    isCheckingAdmin:
      !ready || (!!userId && (query.isLoading || (query.isFetching && query.data === undefined))),
    refetchAdminStatus: query.refetch,
  };
}

export function useIsAdmin(): boolean {
  return useAdminStatus().isAdmin;
}