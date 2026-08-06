import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Facebook, Instagram, ExternalLink, Save, Check, Share2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { useAppPrefs } from "@/lib/app-prefs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/pengaturan-integrasi-sosial")({
  head: () => ({ meta: [{ title: "Facebook & Instagram · Ace Storage" }] }),
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
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-10">
      <SettingsHeader
        title="Facebook & Instagram"
        subtitle="Tautkan akun agar pelanggan bisa menemukan toko Anda"
        icon={Share2}
        status={
          !dirty && (prefs.facebookUrl || prefs.instagramUrl) ? (
            <span className="inline-flex items-center gap-ms-1 rounded-full bg-success/12 px-ms-2 py-0.5 text-ms-2xs font-semibold text-success ring-1 ring-success/20 dark:text-success">
              <Check className="h-3 w-3" strokeWidth={3} />
              Tersimpan
            </span>
          ) : dirty ? (
            <span className="inline-flex items-center gap-ms-1 rounded-full bg-warning/12 px-ms-2 py-0.5 text-ms-2xs font-semibold text-warning ring-1 ring-warning/20 dark:text-warning">
              Belum disimpan
            </span>
          ) : null
        }
      />
      <div className="space-ms-4 px-ms-4 pt-4 sm:pt-5">
        <Card className="overflow-hidden border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-ms-sm font-semibold tracking-tight sm:text-ms-base">
              Tautan halaman &amp; profil
            </CardTitle>
            <CardDescription className="mt-1 text-ms-xs leading-relaxed">
              Tautan disimpan di perangkat dan dipakai untuk membuka aplikasi sosial dari menu bagikan.
              Integrasi API resmi (kirim pesan lintas platform) belum tersedia.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-ms-5 pt-0">
            <div className="space-y-1.5">
              <label htmlFor="fb-url" className="flex items-center gap-ms-2 text-ms-sm font-semibold tracking-tight">
                <span
                  aria-hidden
                  className="grid h-7 w-7 place-items-center rounded-lg bg-[hsl(214,89%,52%)]/10 text-[hsl(214,89%,52%)] ring-1 ring-[hsl(214,89%,52%)]/20"
                >
                  <Facebook className="h-3.5 w-3.5" />
                </span>
                URL Halaman Facebook
              </label>
              <div className="flex gap-ms-2">
                <Input
                  id="fb-url"
                  inputMode="url"
                  placeholder="https://facebook.com/tokoanda"
                  value={fb}
                  onChange={(e) => setFb(e.target.value)}
                  aria-invalid={!fbOk}
                  aria-describedby={!fbOk ? "fb-url-error" : undefined}
                  className={cn(!fbOk && "border-destructive focus-visible:ring-destructive")}
                />
                {prefs.facebookUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Buka Facebook"
                    onClick={() => window.open(prefs.facebookUrl, "_blank", "noopener")}
                    className="min-h-11 min-w-11 shrink-0"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {!fbOk && (
                <p
                  id="fb-url-error"
                  role="alert"
                  className="flex items-center gap-ms-1 text-ms-2xs font-medium text-destructive"
                >
                  <AlertCircle className="h-3 w-3" /> URL tidak valid — awali dengan https://
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="ig-url" className="flex items-center gap-ms-2 text-ms-sm font-semibold tracking-tight">
                <span
                  aria-hidden
                  className="grid h-7 w-7 place-items-center rounded-lg bg-[hsl(340,82%,52%)]/10 text-[hsl(340,82%,52%)] ring-1 ring-[hsl(340,82%,52%)]/20"
                >
                  <Instagram className="h-3.5 w-3.5" />
                </span>
                URL Profil Instagram
              </label>
              <div className="flex gap-ms-2">
                <Input
                  id="ig-url"
                  inputMode="url"
                  placeholder="https://instagram.com/tokoanda"
                  value={ig}
                  onChange={(e) => setIg(e.target.value)}
                  aria-invalid={!igOk}
                  aria-describedby={!igOk ? "ig-url-error" : undefined}
                  className={cn(!igOk && "border-destructive focus-visible:ring-destructive")}
                />
                {prefs.instagramUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Buka Instagram"
                    onClick={() => window.open(prefs.instagramUrl, "_blank", "noopener")}
                    className="min-h-11 min-w-11 shrink-0"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {!igOk && (
                <p
                  id="ig-url-error"
                  role="alert"
                  className="flex items-center gap-ms-1 text-ms-2xs font-medium text-destructive"
                >
                  <AlertCircle className="h-3 w-3" /> URL tidak valid — awali dengan https://
                </p>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border/60 pt-4">
              <span className="text-ms-2xs text-muted-foreground">
                {dirty ? "Perubahan belum disimpan" : "Semua perubahan tersimpan"}
              </span>
              <Button
                size="sm"
                onClick={save}
                disabled={!dirty || !fbOk || !igOk}
                className="min-h-10 gap-ms-1.5"
              >
                <Save className="h-3.5 w-3.5" />
                Simpan
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/70 bg-muted/30 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-ms-sm font-semibold tracking-tight sm:text-ms-base">
              Status integrasi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-ms-2 pt-0 text-ms-xs text-muted-foreground">
            <p className="leading-relaxed">
              <strong className="text-foreground">Cross-post &amp; Inbox:</strong> belum tersedia
              — akan tersedia setelah App Review Meta selesai.
            </p>
            <p className="leading-relaxed">
              <strong className="text-foreground">Untuk saat ini:</strong> tautan yang Anda simpan
              digunakan sebagai tombol &ldquo;buka aplikasi&rdquo; di kartu profil dan menu bagikan
              produk.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}