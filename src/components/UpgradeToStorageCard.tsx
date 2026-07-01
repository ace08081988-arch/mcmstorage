import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ArrowUpCircle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { upgradeChatOnlyToStorage } from "@/lib/upgrade-account.functions";

/**
 * Kartu upgrade akun chat-only → akun MCM Storage penuh.
 * Hanya tampil jika `profiles.chat_only=true`. Butuh verifikasi password
 * ulang sebelum flag di-set false.
 */
export function UpgradeToStorageCard() {
  const navigate = useNavigate();
  const upgradeFn = useServerFn(upgradeChatOnlyToStorage);

  const [checking, setChecking] = useState(true);
  const [chatOnly, setChatOnly] = useState(false);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      const confirmed = Boolean(
        userData.user?.email_confirmed_at || userData.user?.confirmed_at,
      );
      if (!uid) {
        if (alive) setChecking(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("chat_only")
        .eq("id", uid)
        .maybeSingle();
      if (!alive) return;
      setChatOnly(Boolean(data?.chat_only));
      setEmailConfirmed(confirmed);
      setChecking(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (checking || !chatOnly) return null;

  const canSubmit = emailConfirmed && password.length > 0 && !submitting;

  const doUpgrade = async () => {
    setSubmitting(true);
    try {
      const res = await upgradeFn({ data: { password } });
      if (!res.ok) {
        toast.error(res.error ?? "Gagal upgrade akun");
        return;
      }
      toast.success("Akun berhasil di-upgrade ke MCM Storage");
      setChatOnly(false);
      setPassword("");
      setConfirmOpen(false);
      // Refresh ke Beranda supaya sidebar & rute ikut menyesuaikan.
      navigate({ to: "/", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Terjadi kesalahan tak terduga");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ArrowUpCircle className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle className="text-base">Upgrade ke MCM Storage</CardTitle>
          <Badge variant="secondary" className="ml-auto">Chat-only</Badge>
        </div>
        <CardDescription>
          Akun Anda saat ini hanya bisa mengakses fitur chat. Upgrade untuk
          membuka semua fitur MCM Storage (gudang, penjualan, hutang piutang,
          penyiapan pegawai, dll). Data chat tetap utuh.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!emailConfirmed && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            Email belum diverifikasi. Verifikasi email dulu sebelum upgrade agar
            akses tidak diblokir.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="upgrade-password" className="text-sm">
            Konfirmasi password
          </Label>
          <Input
            id="upgrade-password"
            type="password"
            autoComplete="current-password"
            placeholder="Masukkan password akun Anda"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
          />
          <p className="text-[11px] text-muted-foreground">
            Password digunakan hanya untuk verifikasi — tidak disimpan.
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Verifikasi password + email
          </p>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => setConfirmOpen(true)}
            className="gap-2"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowUpCircle className="h-4 w-4" aria-hidden="true" />
            )}
            Upgrade akun
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Upgrade ke MCM Storage?</AlertDialogTitle>
            <AlertDialogDescription>
              Setelah upgrade, akun Anda bisa mengakses semua fitur storage.
              Perubahan ini tidak otomatis reversibel dari aplikasi. Lanjutkan?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Batal</AlertDialogCancel>
            <AlertDialogAction disabled={submitting} onClick={doUpgrade}>
              {submitting ? "Memproses..." : "Ya, upgrade"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}