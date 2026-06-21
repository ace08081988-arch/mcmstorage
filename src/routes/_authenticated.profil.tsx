import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyProfile, useUpdateMyProfile } from "@/lib/profile";

export const Route = createFileRoute("/_authenticated/profil")({
  component: ProfilPage,
});

function ProfilPage() {
  const { data: profile, isLoading } = useMyProfile();
  const update = useUpdateMyProfile();

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");

  // Sinkronkan form dengan data profil yang dimuat.
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name ?? "");
      setPhone(profile.phone ?? "");
    }
  }, [profile?.id, profile?.display_name, profile?.phone]);

  const dirty =
    (profile?.display_name ?? "") !== displayName ||
    (profile?.phone ?? "") !== phone;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({
        display_name: displayName.trim() || null,
        phone: phone.trim() || null,
      });
      toast.success("Profil disimpan");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal menyimpan profil";
      toast.error(msg);
    }
  };

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <header className="flex items-center gap-2">
        <User className="h-5 w-5 text-primary" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Profil akun</h1>
      </header>
      <p className="text-xs text-muted-foreground">
        Data berikut otomatis mengikuti akun login. Email dikelola oleh sistem autentikasi
        dan akan otomatis menyamai akun. Nama tampilan & nomor WhatsApp bisa Anda ubah di sini
        dan akan dipakai sebagai kontak default di seluruh aplikasi.
      </p>

      <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-4">
        <div className="space-y-1.5">
          <Label htmlFor="profil-email">Email akun</Label>
          <Input
            id="profil-email"
            type="email"
            value={profile?.email ?? ""}
            readOnly
            aria-readonly="true"
            className="bg-muted/40"
          />
          <p className="text-[11px] text-muted-foreground">
            Untuk mengubah email, gunakan menu ubah email pada pengaturan akun.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profil-nama">Nama tampilan</Label>
          <Input
            id="profil-nama"
            type="text"
            placeholder="Mis. Toko MCM / Budi"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={120}
            disabled={isLoading}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profil-hp">Nomor WhatsApp / HP</Label>
          <Input
            id="profil-hp"
            type="tel"
            inputMode="tel"
            placeholder="0812xxxxxxxx"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={32}
            disabled={isLoading}
          />
          <p className="text-[11px] text-muted-foreground">
            Dipakai sebagai kontak pengirim di pesan WhatsApp & link pegawai.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="submit"
            disabled={!dirty || update.isPending || isLoading}
            className="gap-2"
          >
            {update.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            Simpan profil
          </Button>
        </div>
      </form>
    </main>
  );
}