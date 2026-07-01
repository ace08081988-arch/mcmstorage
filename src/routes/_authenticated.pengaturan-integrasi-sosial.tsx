import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Facebook, Instagram, ExternalLink, Save, Check } from "lucide-react";
import { toast } from "sonner";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { useAppPrefs } from "@/lib/app-prefs";

export const Route = createFileRoute("/_authenticated/pengaturan-integrasi-sosial")({
  head: () => ({ meta: [{ title: "Facebook & Instagram · MCM Storage" }] }),
  component: IntegrasiSosialPage,
});

function isValidUrl(v: string) {
  if (!v) return true;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function IntegrasiSosialPage() {
  const { prefs, set } = useAppPrefs();
  const [fb, setFb] = useState(prefs.facebookUrl);
  const [ig, setIg] = useState(prefs.instagramUrl);
  const dirty = fb !== prefs.facebookUrl || ig !== prefs.instagramUrl;
  const fbOk = isValidUrl(fb);
  const igOk = isValidUrl(ig);

  const save = () => {
    if (!fbOk || !igOk) {
      toast.error("URL tidak valid — pastikan diawali https://");
      return;
    }
    set({ facebookUrl: fb.trim(), instagramUrl: ig.trim() });
    toast.success("Tautan sosial disimpan.");
  };

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-8">
      <SettingsHeader
        title="Facebook & Instagram"
        subtitle="Tautkan akun agar pelanggan bisa menemukan toko Anda"
      />
      <div className="space-y-4 px-4 pt-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tautan halaman & profil</CardTitle>
            <CardDescription className="text-xs">
              Tautan disimpan di perangkat dan dipakai untuk membuka aplikasi sosial dari menu bagikan.
              Integrasi API resmi (kirim pesan lintas platform) belum tersedia.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="fb-url" className="mb-1 flex items-center gap-2 text-sm font-medium">
                <Facebook className="h-4 w-4 text-[hsl(214,89%,52%)]" />
                URL Halaman Facebook
              </label>
              <div className="flex gap-2">
                <Input
                  id="fb-url"
                  inputMode="url"
                  placeholder="https://facebook.com/tokoanda"
                  value={fb}
                  onChange={(e) => setFb(e.target.value)}
                  aria-invalid={!fbOk}
                />
                {prefs.facebookUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Buka Facebook"
                    onClick={() => window.open(prefs.facebookUrl, "_blank", "noopener")}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {!fbOk && <p className="mt-1 text-[11px] text-destructive">URL tidak valid.</p>}
            </div>

            <div>
              <label htmlFor="ig-url" className="mb-1 flex items-center gap-2 text-sm font-medium">
                <Instagram className="h-4 w-4 text-[hsl(340,82%,52%)]" />
                URL Profil Instagram
              </label>
              <div className="flex gap-2">
                <Input
                  id="ig-url"
                  inputMode="url"
                  placeholder="https://instagram.com/tokoanda"
                  value={ig}
                  onChange={(e) => setIg(e.target.value)}
                  aria-invalid={!igOk}
                />
                {prefs.instagramUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Buka Instagram"
                    onClick={() => window.open(prefs.instagramUrl, "_blank", "noopener")}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {!igOk && <p className="mt-1 text-[11px] text-destructive">URL tidak valid.</p>}
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                {!dirty && (prefs.facebookUrl || prefs.instagramUrl) && (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    Tersimpan
                  </>
                )}
              </span>
              <Button size="sm" onClick={save} disabled={!dirty || !fbOk || !igOk}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Simpan
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Status integrasi</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1.5">
            <p>
              <strong className="text-foreground">Cross-post & Inbox:</strong> belum tersedia — akan tersedia setelah App Review Meta selesai.
            </p>
            <p>
              <strong className="text-foreground">Untuk saat ini:</strong> tautan yang Anda simpan digunakan sebagai tombol "buka aplikasi" di kartu profil dan menu bagikan produk.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}