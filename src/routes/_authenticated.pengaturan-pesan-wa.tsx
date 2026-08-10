import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, MessageSquare, Phone, RotateCcw, Save } from "lucide-react";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AVAILABLE_TOKENS,
  DEFAULT_OPTIONS,
  DEFAULT_TEMPLATE,
  renderWaCaption,
  sampleData,
  type WaTemplateOptions,
} from "@/lib/wa-template";
import {
  loadWaTemplate,
  saveWaTemplate,
} from "@/lib/wa-template-store";
import { COUNTRIES } from "@/lib/countries";
import { normalizeWaNumber, formatWaDisplay } from "@/lib/phone";
import { buildWhatsAppUrl } from "@/lib/share-wa";
import { useMyProfile, useUpdateMyProfile } from "@/lib/profile";

export const Route = createFileRoute("/_authenticated/pengaturan-pesan-wa")({
  head: () => ({
    meta: [
      { title: "Template Pesan WA · Ace Storage" },
      { name: "description", content: "Atur sendiri format caption WhatsApp (judul, harga, status pembayaran, lokasi, catatan, penutup) untuk paket ecer dan request." },
      { property: "og:title", content: "Template Pesan WA · Ace Storage" },
      { property: "og:description", content: "Sesuaikan urutan, label, dan penutup caption WhatsApp." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PesanWaPage,
});

function PesanWaPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<string>(DEFAULT_TEMPLATE);
  const [options, setOptions] = useState<WaTemplateOptions>({ ...DEFAULT_OPTIONS });
  const [scenario, setScenario] = useState<"kas" | "hutang" | "partial">("hutang");
  const [withLoc, setWithLoc] = useState<boolean>(true);

  useEffect(() => {
    let alive = true;
    loadWaTemplate(true)
      .then((rec) => {
        if (!alive) return;
        setTemplate(rec.template);
        setOptions(rec.options);
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const preview = useMemo(() => {
    try {
      return renderWaCaption(template, options, sampleData(scenario, withLoc));
    } catch (e) {
      return `(gagal render: ${(e as Error).message})`;
    }
  }, [template, options, scenario, withLoc]);

  function insertToken(token: string) {
    const el = document.getElementById("wa-template-textarea") as HTMLTextAreaElement | null;
    if (!el) {
      setTemplate((t) => t + token);
      return;
    }
    const start = el.selectionStart ?? template.length;
    const end = el.selectionEnd ?? template.length;
    const next = template.slice(0, start) + token + template.slice(end);
    setTemplate(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveWaTemplate({ template, options });
      toast.success("Template pesan WA tersimpan");
    } catch (e) {
      toast.error("Gagal simpan: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setTemplate(DEFAULT_TEMPLATE);
    setOptions({ ...DEFAULT_OPTIONS });
    toast.info("Template dikembalikan ke default — jangan lupa Simpan.");
  }

  async function copyPreview() {
    try {
      await navigator.clipboard.writeText(preview);
      toast.success("Preview disalin");
    } catch {
      toast.error("Gagal menyalin");
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-ms-4 py-ms-4 sm:px-ms-6 sm:py-ms-6 space-ms-4 sm:space-ms-5">
      <SettingsHeader
        title="Template Pesan WA"
        subtitle="Atur sendiri format caption WhatsApp yang dikirim ke pembeli (judul, harga, status pembayaran, lokasi, catatan, penutup)."
      />

      <SettingsSection
        title="Editor template"
        icon={MessageSquare}
        description="Gunakan token seperti {judul}, {items_block}, {pembayaran}, {catatan_block}. Ketik \\{ atau \\} untuk memasukkan kurung kurawal literal."
        actions={
          <div className="flex gap-ms-1">
            <Button size="sm" variant="outline" onClick={handleReset} disabled={saving}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Default
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || loading}>
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              Simpan
            </Button>
          </div>
        }
      >
        {loading ? (
          <div className="flex items-center gap-ms-2 py-ms-4 text-ms-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat template…
          </div>
        ) : (
          <div className="space-y-ms-3">
            <div className="flex flex-wrap gap-1">
              {AVAILABLE_TOKENS.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  onClick={() => insertToken(t.token)}
                  className="rounded-full border bg-muted/40 px-2 py-1 text-[11px] hover:bg-muted"
                  title={t.label}
                >
                  <code>{t.token}</code>
                </button>
              ))}
            </div>
            <Textarea
              id="wa-template-textarea"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={12}
              className="font-mono text-ms-2xs leading-relaxed"
            />

            <div className="grid gap-ms-3 sm:grid-cols-2">
              <LabeledInput
                label="Emoji header"
                value={options.headerEmoji}
                onChange={(v) => setOptions({ ...options, headerEmoji: v })}
                placeholder="mis. ⭐ , 📦 , atau kosong"
              />
              <LabeledInput
                label="Baris penutup"
                value={options.closing}
                onChange={(v) => setOptions({ ...options, closing: v })}
                placeholder="Terima kasih 🙏"
              />
              <LabeledInput label="Label 'Total'" value={options.labelTotal} onChange={(v) => setOptions({ ...options, labelTotal: v })} />
              <LabeledInput label="Label 'Untuk'" value={options.labelUntuk} onChange={(v) => setOptions({ ...options, labelUntuk: v })} />
              <LabeledInput label="Label 'Catatan'" value={options.labelCatatan} onChange={(v) => setOptions({ ...options, labelCatatan: v })} />
              <LabeledInput label="Label 'Isi paket'" value={options.labelIsi} onChange={(v) => setOptions({ ...options, labelIsi: v })} />
              <LabeledInput label="Label 'kotak'" value={options.labelKotak} onChange={(v) => setOptions({ ...options, labelKotak: v })} />
              <div className="flex items-center justify-between rounded-md border px-ms-2 py-ms-1.5">
                <div>
                  <div className="text-ms-xs font-medium">Mode ringkas isi paket</div>
                  <div className="text-[11px] text-muted-foreground">
                    Aktif = 1 baris ringkas. Nonaktif = daftar per-kotak.
                  </div>
                </div>
                <Switch
                  checked={options.compactItems}
                  onCheckedChange={(v) => setOptions({ ...options, compactItems: v })}
                />
              </div>
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Live preview"
        description="Contoh caption dengan data dummy — berubah otomatis mengikuti template & opsi di atas."
        actions={
          <Button size="sm" variant="outline" onClick={copyPreview}>
            <Copy className="mr-1 h-3.5 w-3.5" /> Salin
          </Button>
        }
      >
        <div className="mb-ms-2 grid gap-ms-2 sm:grid-cols-2">
          <div>
            <Label className="text-ms-xs">Skenario bayar</Label>
            <Select value={scenario} onValueChange={(v) => setScenario(v as typeof scenario)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="kas">Lunas (kas)</SelectItem>
                <SelectItem value="hutang">Hutang penuh</SelectItem>
                <SelectItem value="partial">Bayar sebagian</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-ms-2">
            <div className="flex items-center gap-ms-1 rounded-md border px-ms-2 py-1.5">
              <Switch checked={withLoc} onCheckedChange={setWithLoc} id="wa-preview-loc" />
              <Label htmlFor="wa-preview-loc" className="text-ms-xs">Sertakan lokasi</Label>
            </div>
          </div>
        </div>
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-ms-2 font-sans text-ms-2xs leading-relaxed">
{preview}
        </pre>
        <div className="mt-ms-1 text-[10px] text-muted-foreground">
          {preview.length.toLocaleString("id-ID")} karakter
        </div>
      </SettingsSection>

      <WaPhoneFormatSection />
    </div>
  );
}

/**
 * Pengaturan format nomor WhatsApp.
 *
 * Setiap owner menyimpan default kode negara di `profiles.country_code`
 * (kolom yang sama dengan halaman Profil, jadi satu tempat = satu sumber).
 * Section ini menampilkan preview normalisasi real-time: user mengetik nomor
 * apa adanya ("0812…", "+62 812…", "00 62 812…") dan langsung melihat
 * bagaimana link `wa.me/…` yang akan dipakai tombol Kirim WA.
 */
function WaPhoneFormatSection() {
  const { data: profile, isLoading } = useMyProfile();
  const update = useUpdateMyProfile();
  const [country, setCountry] = useState<string>("ID");
  const [sample, setSample] = useState<string>("");

  useEffect(() => {
    if (profile?.country_code) setCountry(profile.country_code);
    if (profile?.phone) setSample(profile.phone);
  }, [profile?.country_code, profile?.phone]);

  const normalized = normalizeWaNumber(sample, country);
  const display = formatWaDisplay(sample, country);
  const waUrl = normalized ? buildWhatsAppUrl("Halo", sample, country) : "";

  async function handleSave() {
    try {
      await update.mutateAsync({ country_code: country });
      toast.success("Kode negara tersimpan — link wa.me kini otomatis benar.");
    } catch (e) {
      toast.error("Gagal simpan: " + (e as Error).message);
    }
  }

  return (
    <SettingsSection
      title="Format nomor WhatsApp"
      icon={Phone}
      description="Kode negara default dipakai untuk membangun link wa.me dari nomor yang tersimpan (kontak pelanggan, supplier, staf). Nomor lokal ('0812…') otomatis diubah jadi '62812…' saat dikirim."
      actions={
        <Button size="sm" onClick={handleSave} disabled={isLoading || update.isPending || country === (profile?.country_code ?? "ID")}>
          {update.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
          Simpan
        </Button>
      }
    >
      <div className="grid gap-ms-3 sm:grid-cols-2">
        <div>
          <Label className="text-ms-xs">Kode negara default</Label>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.flag} {c.name} (+{c.dial})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-ms-xs">Coba nomor</Label>
          <Input
            className="mt-1"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder="mis. 0812-3456-7890"
            inputMode="tel"
          />
        </div>
      </div>
      <div className="mt-ms-2 space-y-1 rounded-md border bg-muted/40 p-ms-2 text-ms-2xs">
        <div className="flex items-center justify-between gap-ms-2">
          <span className="text-muted-foreground">Tampilan</span>
          <span className="font-mono">{display || <em className="text-muted-foreground">—</em>}</span>
        </div>
        <div className="flex items-center justify-between gap-ms-2">
          <span className="text-muted-foreground">Digit E.164</span>
          <span className="font-mono">{normalized ?? <em className="text-destructive">tidak valid</em>}</span>
        </div>
        <div className="flex items-center justify-between gap-ms-2">
          <span className="text-muted-foreground">Link wa.me</span>
          {waUrl ? (
            <a
              href={waUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate font-mono text-primary underline underline-offset-2"
            >
              {waUrl.replace("?text=Halo", "")}
            </a>
          ) : (
            <em className="text-destructive">tidak bisa dibangun</em>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

function LabeledInput({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <Label className="text-ms-xs">{label}</Label>
      <Input
        className="mt-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}