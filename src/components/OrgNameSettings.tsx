import { useEffect, useRef, useState } from "react";
import { Building2, Save, ImagePlus, Trash2, Palette, RotateCcw, Check } from "lucide-react";
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
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem("app-org-saved-at");
    return v ? Number(v) || null : null;
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

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
    const ts = Date.now();
    try { window.localStorage.setItem("app-org-saved-at", String(ts)); } catch { /* ignore */ }
    setLastSavedAt(ts);
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

  const onResetLogoBrand = () => {
    setOrgLogo("");
    setOrgBrand("");
    setBrand("");
    setHex("#10b981");
    applyBrandColor();
    const ts = Date.now();
    try { window.localStorage.setItem("app-org-saved-at", String(ts)); } catch { /* ignore */ }
    setLastSavedAt(ts);
    toast.success("Logo & warna direset ke bawaan");
  };

  const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
  const MAX_BYTES = 512 * 1024; // 512 KB
  const MAX_DIM = 1024; // px (raster only)

  const onPickFile = (file: File) => {
    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED_MIME.includes(mime as typeof ALLOWED_MIME[number])) {
      toast.error("Format harus PNG, JPG, WEBP, atau SVG");
      return;
    }
    if (file.size === 0) {
      toast.error("File kosong");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`Logo maksimal 512 KB (file Anda ${(file.size / 1024).toFixed(0)} KB)`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error("Gagal membaca file");
    reader.onload = () => {
      const url = String(reader.result || "");
      if (!url.startsWith("data:image/")) {
        toast.error("Isi file bukan gambar valid");
        return;
      }
      // SVG: langsung terima (tidak perlu cek dimensi)
      if (mime === "image/svg+xml") {
        setOrgLogo(url);
        toast.success("Logo diperbarui");
        return;
      }
      // Raster: verifikasi magic bytes lewat decode + batasi dimensi
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth === 0 || img.naturalHeight === 0) {
          toast.error("Gambar tidak valid");
          return;
        }
        if (img.naturalWidth > MAX_DIM || img.naturalHeight > MAX_DIM) {
          toast.error(`Dimensi maksimal ${MAX_DIM}×${MAX_DIM}px (file: ${img.naturalWidth}×${img.naturalHeight})`);
          return;
        }
        setOrgLogo(url);
        toast.success("Logo diperbarui");
      };
      img.onerror = () => toast.error("Gambar rusak atau format tidak dikenali");
      img.src = url;
    };
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
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
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
            PNG, JPG, WEBP, atau SVG. Maks. 512 KB, dimensi ≤ 1024×1024 px. Persegi disarankan.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="org-full">Nama lengkap</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFull(DEFAULT_ORG_NAME);
                setShort(DEFAULT_ORG_SHORT);
                toast.success("Nama & singkatan direset ke bawaan");
              }}
              className="h-7 px-2 text-[11px] gap-1"
            >
              <RotateCcw className="h-3 w-3" /> Reset nama & singkatan
            </Button>
          </div>
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onResetLogoBrand}
            className="h-8 gap-1.5 px-2 text-[11px]"
          >
            <RotateCcw className="h-3 w-3" /> Reset logo & warna
          </Button>
        </div>

        {/* Pratinjau langsung */}
        <div className="space-y-2">
          <Label>Pratinjau langsung</Label>
          <div
            className="space-y-3 rounded-lg border bg-muted/30 p-3"
            style={brand ? ({ ["--primary" as any]: brand, ["--ring" as any]: brand } as React.CSSProperties) : undefined}
          >
            {/* Header sidebar */}
            <div className="rounded-md border bg-background p-2.5">
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Header sidebar
              </div>
              <div className="flex items-center gap-2.5">
                {savedLogo ? (
                  <img
                    src={savedLogo}
                    alt=""
                    aria-hidden
                    className="h-8 w-8 shrink-0 rounded-md object-cover ring-1 ring-border shadow-sm"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary/70 text-[12px] font-bold tracking-tight text-primary-foreground shadow-sm ring-1 ring-primary/20"
                  >
                    {(short || DEFAULT_ORG_SHORT).slice(0, 6)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold leading-tight tracking-tight">
                    {full.trim() || DEFAULT_ORG_NAME}
                  </div>
                  <div className="truncate text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Manajemen Operasional
                  </div>
                </div>
              </div>
            </div>
            {/* Footer publik */}
            <div className="rounded-md border bg-background">
              <div className="px-2.5 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Footer publik
              </div>
              <div className="flex flex-col gap-1 px-2.5 pb-2.5 pt-1 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>
                  © {new Date().getFullYear()}{" "}
                  <strong className="text-foreground">{full.trim() || DEFAULT_ORG_NAME}</strong>
                </p>
                <span className="text-[10px]">Syarat · Refund · Privasi</span>
              </div>
            </div>
            {/* Contoh tombol brand */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Aksen:
              </span>
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground shadow-sm"
              >
                Tombol utama
              </button>
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                Badge
              </span>
            </div>
          </div>
          {dirty && (
            <p className="text-[11px] text-amber-600 dark:text-amber-500">
              Perubahan belum disimpan — tekan Simpan untuk menerapkan.
            </p>
          )}
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