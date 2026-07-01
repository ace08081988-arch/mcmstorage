import { useEffect, useRef, useState } from "react";
import { Building2, Save, ImagePlus, Trash2, Palette } from "lucide-react";
import { toast } from "sonner";
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
import { useOrgLogoDraft } from "@/lib/org-name";
import {
  useOrgName,
  setOrgName,
  setOrgLogo,
  setOrgBrand,
  applyBrandColor,
  DEFAULT_ORG_NAME,
  DEFAULT_ORG_SHORT,
} from "@/lib/org-name";

const BRAND_PRESETS: { label: string; value: string }[] = [
  { label: "Emerald", value: "oklch(0.696 0.17 162.48)" },
  { label: "Biru", value: "oklch(0.623 0.214 259.815)" },
  { label: "Ungu", value: "oklch(0.606 0.25 292.717)" },
  { label: "Merah", value: "oklch(0.637 0.237 25.331)" },
  { label: "Amber", value: "oklch(0.769 0.188 70.08)" },
  { label: "Rose", value: "oklch(0.645 0.246 16.439)" },
];

function hexToOklchLike(hex: string): string {
  // Store the hex as-is; browsers accept hex for --primary since we don't
  // wrap it in oklch(). CSS custom prop just needs a color value.
  return hex;
}

export function OrgNameSettings() {
  const { full: savedFull, short: savedShort, logo: savedLogo, brand: savedBrand } = useOrgName();
  const [full, setFull] = useState(savedFull);
  const [short, setShort] = useState(savedShort);
  const [brand, setBrand] = useState(savedBrand);
  const [hex, setHex] = useState(savedBrand.startsWith("#") ? savedBrand : "#10b981");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFull(savedFull);
    setShort(savedShort);
    setBrand(savedBrand);
  }, [savedFull, savedShort, savedBrand]);

  const dirty =
    full.trim() !== savedFull ||
    short.trim() !== savedShort ||
    brand !== savedBrand;

  const onSave = () => {
    setOrgName(full, short);
    setOrgBrand(brand);
    toast.success("Nama organisasi disimpan");
  };

  const onReset = () => {
    setOrgName(DEFAULT_ORG_NAME, DEFAULT_ORG_SHORT);
    setOrgBrand("");
    setOrgLogo("");
    setBrand("");
    applyBrandColor();
    toast.success("Dikembalikan ke bawaan");
  };

  const onPickFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("File harus berupa gambar");
      return;
    }
    if (file.size > 512 * 1024) {
      toast.error("Logo maksimal 512 KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      setOrgLogo(url);
      toast.success("Logo diperbarui");
    };
    reader.onerror = () => toast.error("Gagal membaca file");
    reader.readAsDataURL(file);
  };

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
          <CardTitle className="text-base">Identitas & branding</CardTitle>
        </div>
        <CardDescription>
          Nama, logo, dan warna utama. Muncul di sidebar, footer publik, serta warna aksen aplikasi.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Logo */}
        <div className="space-y-2">
          <Label>Logo</Label>
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-muted flex items-center justify-center">
              {savedLogo ? (
                <img src={savedLogo} alt="Logo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-[11px] font-bold tracking-wider text-muted-foreground">
                  {short || DEFAULT_ORG_SHORT}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickFile(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                className="gap-1.5"
              >
                <ImagePlus className="h-3.5 w-3.5" /> Pilih logo
              </Button>
              {savedLogo && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOrgLogo("");
                    toast.success("Logo dihapus");
                  }}
                  className="gap-1.5 text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Hapus
                </Button>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            PNG/JPG persegi disarankan, maks. 512 KB.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="org-full">Nama lengkap</Label>
          <Input
            id="org-full"
            value={full}
            onChange={(e) => setFull(e.target.value)}
            placeholder={DEFAULT_ORG_NAME}
            maxLength={60}
            className="h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-short">Singkatan / lencana (fallback logo)</Label>
          <Input
            id="org-short"
            value={short}
            onChange={(e) => setShort(e.target.value.toUpperCase().slice(0, 6))}
            placeholder={DEFAULT_ORG_SHORT}
            maxLength={6}
            className="h-10 uppercase tracking-wider"
          />
          <p className="text-[11px] text-muted-foreground">
            Maks. 6 karakter, tampil saat logo kosong.
          </p>
        </div>

        {/* Brand color */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <Palette className="h-3.5 w-3.5" /> Warna utama (brand)
          </Label>
          <div className="flex flex-wrap gap-2">
            {BRAND_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setBrand(p.value)}
                className={`h-8 w-8 rounded-full border-2 transition ${
                  brand === p.value ? "border-foreground scale-110" : "border-transparent"
                }`}
                style={{ background: p.value }}
                aria-label={p.label}
                title={p.label}
              />
            ))}
            <button
              type="button"
              onClick={() => setBrand("")}
              className={`h-8 rounded-full border px-3 text-[11px] font-medium ${
                !brand ? "border-primary bg-accent" : "border-muted"
              }`}
            >
              Bawaan tema
            </button>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="color"
              value={hex}
              onChange={(e) => {
                setHex(e.target.value);
                setBrand(hexToOklchLike(e.target.value));
              }}
              className="h-9 w-12 cursor-pointer rounded border bg-transparent"
              aria-label="Warna kustom"
            />
            <Input
              value={hex}
              onChange={(e) => {
                setHex(e.target.value);
                if (/^#[0-9a-f]{6}$/i.test(e.target.value)) {
                  setBrand(hexToOklchLike(e.target.value));
                }
              }}
              placeholder="#10b981"
              className="h-9 flex-1 font-mono text-xs"
              maxLength={7}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Menggantikan aksen dari Tampilan. Kosongkan untuk kembali ke tema.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-xs"
          >
            Reset ke bawaan
          </Button>
          <Button
            type="button"
            onClick={onSave}
            disabled={!dirty || !full.trim()}
            className="gap-2"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Simpan
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}