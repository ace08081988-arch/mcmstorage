/**
 * Gate fitur premium. Ini murni lapisan UX — penegakan sebenarnya tetap ada di
 * database lewat `has_active_pro(uid)` dan RLS. Dipakai untuk membungkus
 * halaman yang hanya untuk paket Pro agar muncul ajakan upgrade, bukan error.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Crown, Lock } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function useIsPro() {
  return useQuery({
    queryKey: ["is-pro"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return false;
      const { data, error } = await supabase.rpc("has_active_pro", { _uid: uid });
      if (error) return false;
      return Boolean(data);
    },
  });
}

export function ProGate({
  feature,
  children,
}: {
  /** Nama fitur yang dikunci, tampil di ajakan upgrade. */
  feature: string;
  children: ReactNode;
}) {
  const { data: isPro, isLoading } = useIsPro();

  if (isLoading) {
    return (
      <div className="space-ms-2" data-testid="pro-gate-loading">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isPro) return <>{children}</>;

  return (
    <Card className="border-primary/40" data-testid="pro-gate-locked">
      <CardHeader>
        <div className="flex items-center gap-ms-2">
          <Lock className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle className="text-ms-base">{feature} khusus paket Pro</CardTitle>
        </div>
        <CardDescription>
          Fitur ini terbuka setelah akun Anda berlangganan MCM Storage Pro.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/langganan">
            <Crown className="mr-2 h-4 w-4" aria-hidden="true" />
            Lihat paket Pro
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
