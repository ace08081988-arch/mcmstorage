import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMyProfile, useUpdateMyProfile } from "@/lib/profile";
import { normalizeWaNumber, formatWaDisplay } from "@/lib/phone";
import { COUNTRIES, LANGUAGES, DATE_FORMATS, findCountry } from "@/lib/countries";
import { formatCurrency, formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/profil")({
  component: ProfilPage,
});

function ProfilPage() {
  const { data: profile, isLoading } = useMyProfile();
  const update = useUpdateMyProfile();

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("ID");
  const [language, setLanguage] = useState("id");
  const [currency, setCurrency] = useState("IDR");
  const [dateFormat, setDateFormat] = useState("DD/MM/YYYY");

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
          <div className="flex gap-2">
            <select
              aria-label="Kode negara"
              value={countryCode}
              onChange={(e) => onCountryChange(e.target.value)}
              disabled={isLoading}
              className="h-9 max-w-[10rem] rounded-md border bg-background px-2 text-sm"
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
          />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Dipakai sebagai kontak pengirim di pesan WhatsApp & link pegawai.
            {phone.trim() && normalizeWaNumber(phone, countryCode) && (
              <> Format wa.me: <span className="font-medium text-foreground">{formatWaDisplay(phone, countryCode)}</span></>
            )}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="profil-lang">Bahasa antarmuka</Label>
            <select
              id="profil-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={isLoading}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profil-currency">Mata uang</Label>
            <Input
              id="profil-currency"
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
              maxLength={3}
              disabled={isLoading}
            />
            <p className="text-[11px] text-muted-foreground">
              Contoh: <span className="font-medium text-foreground">{formatCurrency(1234567, previewProfile)}</span>
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="profil-date">Format tanggal</Label>
            <select
              id="profil-date"
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value)}
              disabled={isLoading}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              {DATE_FORMATS.map((f) => (
                <option key={f.code} value={f.code}>{f.code} — {f.sample}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Hari ini: <span className="font-medium text-foreground">{formatDate(new Date(), previewProfile)}</span>
            </p>
          </div>
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