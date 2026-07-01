import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  User,
  Mail,
  Phone,
  Globe2,
  Languages,
  Coins,
  CalendarDays,
  ShieldCheck,
  BadgeCheck,
  Camera,
  Trash2,
} from "lucide-react";

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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  useMyProfile,
  useUpdateMyProfile,
  uploadMyAvatar,
  removeAvatarObject,
  useAvatarSignedUrl,
} from "@/lib/profile";
import { normalizeWaNumber, formatWaDisplay } from "@/lib/phone";
import { COUNTRIES, LANGUAGES, DATE_FORMATS, findCountry } from "@/lib/countries";
import { formatCurrency, formatDate } from "@/lib/format";
import { PushNotificationSettings } from "@/components/chat/PushNotificationSettings";
import { OrgNameSettings } from "@/components/OrgNameSettings";
import { UpgradeToStorageCard } from "@/components/UpgradeToStorageCard";

export const Route = createFileRoute("/_authenticated/profil")({
  component: ProfilPage,
});

function ProfilPage() {
  const { data: profile, isLoading } = useMyProfile();
  const update = useUpdateMyProfile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("ID");
  const [language, setLanguage] = useState("id");
  const [currency, setCurrency] = useState("IDR");
  const [dateFormat, setDateFormat] = useState("DD/MM/YYYY");

  const { data: avatarUrl } = useAvatarSignedUrl(profile?.avatar_url);

  // Sinkronkan form dengan data profil yang dimuat.
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name ?? "");
      setPhone(profile.phone ?? "");
      setCountryCode(profile.country_code || "ID");
      setLanguage(profile.language || "id");
      setCurrency(profile.currency || "IDR");
      setDateFormat(profile.date_format || "DD/MM/YYYY");
    }
  }, [
    profile?.id,
    profile?.display_name,
    profile?.phone,
    profile?.country_code,
    profile?.language,
    profile?.currency,
    profile?.date_format,
  ]);

  const dirty =
    (profile?.display_name ?? "") !== displayName ||
    (profile?.phone ?? "") !== phone ||
    (profile?.country_code ?? "ID") !== countryCode ||
    (profile?.language ?? "id") !== language ||
    (profile?.currency ?? "IDR") !== currency ||
    (profile?.date_format ?? "DD/MM/YYYY") !== dateFormat;

  // Saat negara berubah, otomatis usulkan mata uang negara tsb (pengguna tetap bisa override).
  const onCountryChange = (code: string) => {
    setCountryCode(code);
    const c = findCountry(code);
    setCurrency(c.currency);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawPhone = phone.trim();
    let phoneToSave: string | null = null;
    if (rawPhone) {
      const norm = normalizeWaNumber(rawPhone, countryCode);
      if (!norm) {
        toast.error("Nomor WhatsApp tidak valid untuk negara terpilih (8–15 digit)");
        return;
      }
      phoneToSave = norm;
    }
    try {
      await update.mutateAsync({
        display_name: displayName.trim() || null,
        phone: phoneToSave,
        country_code: countryCode,
        language,
        currency,
        date_format: dateFormat,
      });
      if (phoneToSave) setPhone(phoneToSave);
      toast.success("Profil disimpan");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal menyimpan profil";
      toast.error(msg);
    }
  };

  const previewProfile = { currency, country_code: countryCode, date_format: dateFormat, language };

  const initials = (displayName || profile?.email || "?")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("") || "?";
  const country = findCountry(countryCode);
  const phoneValid = phone.trim() ? !!normalizeWaNumber(phone, countryCode) : null;

  const handleAvatarFile = async (file: File | null | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const newPath = await uploadMyAvatar(file);
      const oldPath = profile?.avatar_url ?? null;
      await update.mutateAsync({ avatar_url: newPath });
      if (oldPath && oldPath !== newPath) await removeAvatarObject(oldPath);
      toast.success("Foto profil diperbarui");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal mengunggah foto";
      toast.error(msg);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAvatarRemove = async () => {
    if (!profile?.avatar_url) return;
    setUploading(true);
    try {
      const oldPath = profile.avatar_url;
      await update.mutateAsync({ avatar_url: null });
      await removeAvatarObject(oldPath);
      toast.success("Foto profil dihapus");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal menghapus foto";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 pb-12">
      {/* Hero header */}
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/15 via-primary/5 to-background p-5 sm:p-6">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative">
            <Avatar className="h-20 w-20 ring-2 ring-primary/30 ring-offset-2 ring-offset-background">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="Foto profil" /> : null}
              <AvatarFallback className="bg-primary/15 text-xl font-semibold text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || isLoading}
              className="absolute -bottom-1 -right-1 inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background shadow-sm transition hover:bg-accent disabled:opacity-60"
              aria-label="Ubah foto profil"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleAvatarFile(e.target.files?.[0])}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {displayName || "Profil akun"}
              </h1>
              {profile?.email && (
                <BadgeCheck className="h-4 w-4 flex-none text-primary" aria-hidden="true" />
              )}
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {profile?.email ?? "Memuat akun…"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || isLoading}
                className="h-7 gap-1.5 text-xs"
              >
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                {profile?.avatar_url ? "Ganti foto" : "Unggah foto"}
              </Button>
              {profile?.avatar_url && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleAvatarRemove}
                  disabled={uploading}
                  className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Hapus
                </Button>
              )}
              <span className="text-[10px] text-muted-foreground">JPG/PNG, maks 3 MB</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="gap-1">
                <Globe2 className="h-3 w-3" aria-hidden="true" />
                {country.flag} {country.name}
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Coins className="h-3 w-3" aria-hidden="true" />
                {currency}
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Languages className="h-3 w-3" aria-hidden="true" />
                {LANGUAGES.find((l) => l.code === language)?.name ?? language}
              </Badge>
            </div>
          </div>
        </div>
      </section>

      <form onSubmit={onSubmit} className="space-y-5">
        {/* Identitas */}
        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-primary" aria-hidden="true" />
              <CardTitle className="text-base">Identitas</CardTitle>
            </div>
            <CardDescription>
              Nama tampilan dan email yang dipakai di seluruh aplikasi.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
              <Label htmlFor="profil-email" className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                Email akun
              </Label>
              <div className="relative">
                <Input
                  id="profil-email"
                  type="email"
                  value={profile?.email ?? ""}
                  readOnly
                  aria-readonly="true"
                  className="bg-muted/40 pr-20"
                />
                <Badge
                  variant="outline"
                  className="absolute right-2 top-1/2 -translate-y-1/2 gap-1 text-[10px]"
                >
                  <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                  Terkunci
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Untuk mengubah email, gunakan menu ubah email pada pengaturan akun.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Kontak */}
        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" aria-hidden="true" />
              <CardTitle className="text-base">Kontak WhatsApp</CardTitle>
            </div>
            <CardDescription>
              Nomor pengirim default untuk pesan WhatsApp & link pegawai.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="profil-hp">Nomor WhatsApp / HP</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  aria-label="Kode negara"
                  value={countryCode}
                  onChange={(e) => onCountryChange(e.target.value)}
                  disabled={isLoading}
                  className="h-10 w-full rounded-md border bg-background px-2 text-sm sm:max-w-[12rem]"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.name} (+{c.dial})
                    </option>
                  ))}
                </select>
                <Input
                  id="profil-hp"
                  type="tel"
                  inputMode="tel"
                  placeholder={countryCode === "ID" ? "0812xxxxxxxx" : "nomor lokal"}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={32}
                  disabled={isLoading}
                  className="h-10"
                />
              </div>
              {phone.trim() && (
                <div className="flex items-center gap-2 pt-1">
                  {phoneValid ? (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <BadgeCheck className="h-3 w-3 text-primary" aria-hidden="true" />
                      {formatWaDisplay(phone, countryCode)}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">
                      Nomor belum valid
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Preferensi Regional */}
        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-primary" aria-hidden="true" />
              <CardTitle className="text-base">Preferensi regional</CardTitle>
            </div>
            <CardDescription>
              Bahasa, mata uang, dan format tanggal di seluruh aplikasi.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profil-lang" className="flex items-center gap-1.5">
                <Languages className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                Bahasa antarmuka
              </Label>
              <select
                id="profil-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={isLoading}
                className="h-10 w-full rounded-md border bg-background px-2 text-sm"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profil-currency" className="flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                Mata uang
              </Label>
              <Input
                id="profil-currency"
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                maxLength={3}
                disabled={isLoading}
                className="h-10 uppercase tracking-wider"
              />
              <p className="text-[11px] text-muted-foreground">
                Contoh: <span className="font-medium text-foreground">{formatCurrency(1234567, previewProfile)}</span>
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="profil-date" className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                Format tanggal
              </Label>
              <select
                id="profil-date"
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value)}
                disabled={isLoading}
                className="h-10 w-full rounded-md border bg-background px-2 text-sm"
              >
                {DATE_FORMATS.map((f) => (
                  <option key={f.code} value={f.code}>{f.code} — {f.sample}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Hari ini: <span className="font-medium text-foreground">{formatDate(new Date(), previewProfile)}</span>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Action bar */}
        <div className="sticky bottom-2 z-10 flex items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur">
          <p className="text-xs text-muted-foreground">
            {dirty ? "Ada perubahan belum disimpan." : "Semua perubahan tersimpan."}
          </p>
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

      <Separator />

      <PushNotificationSettings />

      <Separator />

      <OrgNameSettings />

      <Separator />

      <UpgradeToStorageCard />
    </main>
  );
}