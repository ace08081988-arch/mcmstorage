import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { useAppPrefs } from "@/lib/app-prefs";
import { Check } from "lucide-react";

export const Route = createFileRoute("/_authenticated/pengaturan-bahasa")({
  head: () => ({ meta: [{ title: "Bahasa Aplikasi · MCM Storage" }] }),
  component: PengaturanBahasaPage,
});

const OPTIONS: Array<{ code: "id" | "en"; label: string; native: string; hint: string }> = [
  { code: "id", label: "Bahasa Indonesia", native: "Indonesia", hint: "Rekomendasi — seluruh UI sudah diterjemahkan." },
  { code: "en", label: "English", native: "English", hint: "Sebagian teks masih dalam Bahasa Indonesia; terjemahan bertahap." },
];

function PengaturanBahasaPage() {
  const { prefs, set } = useAppPrefs();

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-8">
      <SettingsHeader title="Bahasa Aplikasi" subtitle="Pilih bahasa yang paling nyaman" />
      <div className="px-4 pt-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Bahasa</CardTitle>
            <CardDescription className="text-xs">
              Pengaturan disimpan di perangkat ini. Atribut <code>lang</code> pada <code>&lt;html&gt;</code> ikut diperbarui untuk pembaca layar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={prefs.language}
              onValueChange={(v) => set({ language: v as "id" | "en" })}
              className="space-y-2"
            >
              {OPTIONS.map((o) => {
                const active = prefs.language === o.code;
                return (
                  <label
                    key={o.code}
                    htmlFor={`lang-${o.code}`}
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${active ? "border-primary bg-primary/5" : "hover:bg-accent/40"}`}
                  >
                    <RadioGroupItem id={`lang-${o.code}`} value={o.code} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`lang-${o.code}`} className="text-sm font-medium">
                          {o.label}
                        </Label>
                        <span className="text-xs text-muted-foreground">· {o.native}</span>
                        {active && <Check className="ml-auto h-4 w-4 text-primary" />}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{o.hint}</p>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}