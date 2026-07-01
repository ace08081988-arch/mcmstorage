import { useEffect, useRef, useState } from "react";
import { Building2, Save, ImagePlus, Trash2, Palette, RotateCcw, Check, AlertCircle } from "lucide-react";
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

async function compressRaster(
  img: HTMLImageElement,
  srcMime: string,
  maxDim: number,
  maxBytes: number,
): Promise<{ dataUrl: string; mime: string; width: number; height: number; size: number }> {
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  // Target MIME: PNG stays PNG (preserve alpha); JPG/WEBP → WEBP (kompresi paling efisien).
  const targetMime = srcMime === "image/png" ? "image/png" : "image/webp";
  // Skala awal agar sisi terpanjang ≤ maxDim.
  const initialScale = Math.min(1, maxDim / Math.max(w0, h0));
  const attempts: Array<{ scale: number; quality: number }> = [];
  const scales = [initialScale, initialScale * 0.85, initialScale * 0.7, initialScale * 0.55, initialScale * 0.4];
  const qualities = targetMime === "image/png" ? [1] : [0.9, 0.8, 0.7, 0.6, 0.5];
  for (const s of scales) {
    for (const q of qualities) attempts.push({ scale: s, quality: q });
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D tidak tersedia");
  let last: { dataUrl: string; mime: string; width: number; height: number; size: number } | null = null;
  for (const { scale, quality } of attempts) {
    const w = Math.max(MIN_DIM_FLOOR, Math.round(w0 * scale));
    const h = Math.max(MIN_DIM_FLOOR, Math.round(h0 * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL(targetMime, quality);
    const size = Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);
    last = { dataUrl, mime: targetMime, width: w, height: h, size };
    if (size <= maxBytes) return last;
  }
  if (!last) throw new Error("Kompresi gagal");
  return last;
}

const MIN_DIM_FLOOR = 64;

// SVG hardening — batas & pola berbahaya.
const SVG_MAX_BYTES = 128 * 1024; // 128 KB — SVG teks kecil, batas ketat.
const SVG_MAX_ELEMENTS = 2000;    // cegah bomb parser
const SVG_MAX_DEPTH = 32;         // cegah nested-recursion abuse
const SVG_UNSAFE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /<script\b/i, label: "elemen <script>" },
  { re: /<foreignObject\b/i, label: "elemen <foreignObject>" },
  { re: /<iframe\b/i, label: "elemen <iframe>" },
  { re: /<object\b/i, label: "elemen <object>" },
  { re: /<embed\b/i, label: "elemen <embed>" },
  { re: /<link\b/i, label: "elemen <link>" },
  { re: /<meta\b/i, label: "elemen <meta>" },
  { re: /<use\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:|\/\/)/i, label: "<use href> eksternal" },
  { re: /\bxlink:href\s*=\s*["']?\s*(?:https?:|\/\/|javascript:|data:)/i, label: "xlink:href berbahaya" },
  { re: /\bhref\s*=\s*["']?\s*javascript:/i, label: "href javascript:" },
  { re: /\bon[a-z]+\s*=/i, label: "atribut event handler (onload/onclick/…)" },
  { re: /<!ENTITY\b/i, label: "deklarasi <!ENTITY> (risiko XXE)" },
  { re: /<!DOCTYPE\b[^>]*\[/i, label: "DOCTYPE dengan internal subset" },
  { re: /&#?x?[0-9a-z]+;.*&#?x?[0-9a-z]+;.*&#?x?[0-9a-z]+;/i, label: "entitas berulang mencurigakan" },
];

type SvgCheck = { ok: true; sanitized: string } | { ok: false; reason: string };

function validateSvg(raw: string): SvgCheck {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "SVG kosong" };
  if (!/^<\?xml[^>]*\?>\s*<svg[\s>]/i.test(text) && !/^<svg[\s>]/i.test(text)) {
    return { ok: false, reason: "bukan dokumen SVG valid (tidak diawali <svg>)" };
  }
  for (const { re, label } of SVG_UNSAFE_PATTERNS) {
    if (re.test(text)) return { ok: false, reason: `mengandung ${label}` };
  }
  // Complexity — total tag & kedalaman.
  let elementCount = 0;
  let depth = 0;
  let maxDepth = 0;
  const tagRe = /<\/?([a-zA-Z][\w:-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text))) {
    const isClose = text[m.index + 1] === "/";
    const isSelfClose = text.slice(m.index).indexOf(">") > 0 && text[m.index + text.slice(m.index).indexOf(">") - 1] === "/";
    if (!isClose) {
      elementCount++;
      if (!isSelfClose) {
        depth++;
        if (depth > maxDepth) maxDepth = depth;
      }
    } else {
      depth = Math.max(0, depth - 1);
    }
    if (elementCount > SVG_MAX_ELEMENTS) {
      return { ok: false, reason: `terlalu kompleks (>${SVG_MAX_ELEMENTS} elemen)` };
    }
    if (maxDepth > SVG_MAX_DEPTH) {
      return { ok: false, reason: `sarang elemen terlalu dalam (>${SVG_MAX_DEPTH})` };
    }
  }
  // Parser DOM cross-check — memastikan XML well-formed.
  try {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const err = doc.querySelector("parsererror");
    if (err) return { ok: false, reason: "SVG tidak well-formed (parser error)" };
    if (!doc.documentElement || doc.documentElement.nodeName.toLowerCase() !== "svg") {
      return { ok: false, reason: "root element bukan <svg>" };
    }
    // Second-pass check pada DOM untuk atribut event handler yang lolos regex.
    const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT);
    let node: Node | null = walker.currentNode;
    while (node) {
      const el = node as Element;
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const val = attr.value.toLowerCase().trim();
        if (name.startsWith("on")) return { ok: false, reason: `atribut event ${attr.name} pada <${el.tagName}>` };
        if ((name === "href" || name === "xlink:href") && (val.startsWith("javascript:") || val.startsWith("data:text"))) {
          return { ok: false, reason: `href berbahaya (${val.slice(0, 20)}…)` };
        }
      }
      node = walker.nextNode();
    }
  } catch {
    return { ok: false, reason: "gagal parse SVG" };
  }
  return { ok: true, sanitized: text };
}

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
  const [logoError, setLogoError] = useState<string | null>(null);
  type PendingLogo = { url: string; size: number; width: number; height: number; mime: string };
  const [pendingLogo, setPendingLogo] = useState<PendingLogo | null>(null);
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
    brand !== savedBrand ||
    pendingLogo !== null;

  const onSave = () => {
    setOrgName(full, short);
    setOrgBrand(brand);
    if (pendingLogo) {
      setOrgLogo(pendingLogo.url);
      setPendingLogo(null);
    }
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
    setPendingLogo(null);
    applyBrandColor();
    toast.success("Dikembalikan ke bawaan");
  };

  const onResetLogoBrand = () => {
    setOrgLogo("");
    setOrgBrand("");
    setBrand("");
    setHex("#10b981");
    setPendingLogo(null);
    applyBrandColor();
    const ts = Date.now();
    try { window.localStorage.setItem("app-org-saved-at", String(ts)); } catch { /* ignore */ }
    setLastSavedAt(ts);
    toast.success("Logo & warna direset ke bawaan");
  };

  const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
  const MAX_BYTES = 512 * 1024; // 512 KB
  const MIN_DIM = 64; // px — cegah logo pecah saat di-render 32-64px
  const MAX_DIM = 1024; // px (raster only)
  const MIN_RATIO = 0.5; // 1:2 (portrait terjauh)
  const MAX_RATIO = 2.0; // 2:1 (landscape terjauh)

  const fail = (msg: string) => {
    setLogoError(msg);
    toast.error(msg);
  };

  const onPickFile = (file: File) => {
    setLogoError(null);
    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED_MIME.includes(mime as typeof ALLOWED_MIME[number])) {
      fail(`Format tidak didukung (${mime || "tidak dikenali"}). Gunakan PNG, JPG, WEBP, atau SVG.`);
      return;
    }
    if (file.size === 0) {
      fail("File kosong — pilih file lain.");
      return;
    }
    if (mime === "image/svg+xml") {
      if (file.size > SVG_MAX_BYTES) {
        fail(`SVG ${(file.size / 1024).toFixed(0)} KB melebihi batas ${(SVG_MAX_BYTES / 1024).toFixed(0)} KB.`);
        return;
      }
      const svgReader = new FileReader();
      svgReader.onerror = () => fail("Gagal membaca SVG — coba lagi.");
      svgReader.onload = () => {
        const raw = String(svgReader.result || "");
        const check = validateSvg(raw);
        if (!check.ok) {
          fail(`SVG ditolak: ${check.reason}. Ekspor ulang tanpa script/atribut event/referensi eksternal.`);
          return;
        }
        const encoded = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(check.sanitized)))}`;
        setPendingLogo({ url: encoded, size: file.size, width: 0, height: 0, mime });
        toast.success("SVG lolos pemeriksaan keamanan — tekan Simpan.");
      };
      svgReader.readAsText(file);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => fail("Gagal membaca file — coba lagi.");
    reader.onload = () => {
      const url = String(reader.result || "");
      if (!url.startsWith("data:image/")) {
        fail("Isi file bukan gambar valid (magic bytes tidak cocok).");
        return;
      }
      const img = new Image();
      img.onload = async () => {
        const w0 = img.naturalWidth;
        const h0 = img.naturalHeight;
        if (w0 === 0 || h0 === 0) {
          fail("Gambar tidak valid — dimensi 0×0.");
          return;
        }
        if (w0 < MIN_DIM || h0 < MIN_DIM) {
          fail(`Dimensi terlalu kecil (${w0}×${h0}). Minimum ${MIN_DIM}×${MIN_DIM}px agar logo tetap tajam.`);
          return;
        }
        const ratio = w0 / h0;
        if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
          const r = ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
          fail(`Rasio ${r} terlalu ekstrem. Gunakan rasio antara 1:2 dan 2:1 (persegi paling ideal).`);
          return;
        }
        // Auto-resize + kompresi bila melebihi batas dimensi atau ukuran file.
        const needsWork = w0 > MAX_DIM || h0 > MAX_DIM || file.size > MAX_BYTES;
        let finalUrl = url;
        let finalMime = mime;
        let finalW = w0;
        let finalH = h0;
        let finalSize = file.size;
        let compressed = false;
        if (needsWork) {
          try {
            const result = await compressRaster(img, mime, MAX_DIM, MAX_BYTES);
            finalUrl = result.dataUrl;
            finalMime = result.mime;
            finalW = result.width;
            finalH = result.height;
            finalSize = result.size;
            compressed = true;
          } catch (err) {
            fail(`Gagal mengecilkan gambar otomatis: ${err instanceof Error ? err.message : "kesalahan tidak dikenali"}.`);
            return;
          }
          if (finalSize > MAX_BYTES) {
            fail(`Gambar tetap ${(finalSize / 1024).toFixed(0)} KB setelah kompresi otomatis (batas 512 KB). Pilih gambar lebih sederhana.`);
            return;
          }
        }
        setPendingLogo({ url: finalUrl, size: finalSize, width: finalW, height: finalH, mime: finalMime });
        if (compressed) {
          const shrunk = finalW !== w0 || finalH !== h0;
          toast.success(
            `Logo dioptimalkan otomatis: ${shrunk ? `${w0}×${h0} → ${finalW}×${finalH}, ` : ""}${(file.size / 1024).toFixed(0)} KB → ${(finalSize / 1024).toFixed(0)} KB${finalMime !== mime ? ` (${finalMime.replace("image/", "").toUpperCase()})` : ""}. Tekan Simpan.`,
          );
        } else {
          toast.success(
            Math.abs(ratio - 1) < 0.05
              ? "Logo siap — tekan Simpan untuk menerapkan"
              : `Logo siap (${finalW}×${finalH}, rasio ${ratio.toFixed(2)}:1) — tekan Simpan.`,
          );
        }
      };
      img.onerror = () => fail("Gambar rusak atau format tidak dikenali.");
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
          <div className="flex items-start gap-3">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-muted flex items-center justify-center">
              {pendingLogo ? (
                <img src={pendingLogo.url} alt="Pratinjau logo baru" className="h-full w-full object-cover" />
              ) : savedLogo ? (
                <img src={savedLogo} alt="Logo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-[11px] font-bold tracking-wider text-muted-foreground">
                  {short || DEFAULT_ORG_SHORT}
                </span>
              )}
              {pendingLogo && (
                <span
                  className="absolute inset-x-0 bottom-0 bg-amber-500/90 text-center text-[9px] font-semibold uppercase tracking-wider text-white"
                  aria-hidden="true"
                >
                  Baru
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-wrap gap-2">
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
              {pendingLogo && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPendingLogo(null);
                    setLogoError(null);
                    toast.message("Pratinjau logo dibatalkan");
                  }}
                  className="gap-1.5"
                >
                  Batalkan pratinjau
                </Button>
              )}
              {!pendingLogo && savedLogo && (
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
          {pendingLogo && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-500">
                <ImagePlus className="h-3 w-3" aria-hidden="true" />
                Pratinjau logo baru — belum disimpan
              </div>
              <div className="mb-2 grid grid-cols-2 gap-2">
                <figure className="rounded-md border bg-muted/30 p-1.5">
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="font-semibold uppercase tracking-wide text-muted-foreground">Lama</span>
                    <span className="text-muted-foreground">
                      {savedLogo ? "tersimpan" : "kosong"}
                    </span>
                  </div>
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded bg-background">
                    {savedLogo ? (
                      <img src={savedLogo} alt="Logo lama" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span
                        className="flex h-full w-full items-center justify-center font-semibold text-primary"
                        style={{ backgroundColor: draftBrand || undefined }}
                      >
                        {(draftShort || "MCM").slice(0, 3)}
                      </span>
                    )}
                  </div>
                </figure>
                <figure className="rounded-md border border-primary/60 bg-primary/5 p-1.5 ring-1 ring-primary/40">
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="font-semibold uppercase tracking-wide text-primary">Baru</span>
                    <span className="text-primary/80">akan disimpan</span>
                  </div>
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded bg-background">
                    <img src={pendingLogo.url} alt="Logo baru" className="max-h-full max-w-full object-contain" />
                  </div>
                </figure>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                <dt>Format</dt>
                <dd className="font-mono text-foreground">{pendingLogo.mime.replace("image/", "").toUpperCase()}</dd>
                <dt>Ukuran file</dt>
                <dd className="font-mono text-foreground">{formatBytes(pendingLogo.size)}</dd>
                <dt>Dimensi</dt>
                <dd className="font-mono text-foreground">
                  {pendingLogo.width > 0
                    ? `${pendingLogo.width} × ${pendingLogo.height} px`
                    : "Vektor (SVG)"}
                </dd>
                {pendingLogo.width > 0 && (
                  <>
                    <dt>Rasio</dt>
                    <dd className="font-mono text-foreground">
                      {(pendingLogo.width / pendingLogo.height).toFixed(2)}:1
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            PNG, JPG, WEBP, atau SVG. Maks. 512 KB, dimensi 64–1024 px, rasio 1:2 s.d. 2:1 (persegi paling ideal).
          </p>
          {logoError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <div className="flex-1 leading-snug">{logoError}</div>
              <button
                type="button"
                onClick={() => setLogoError(null)}
                className="text-[10px] font-medium underline underline-offset-2 opacity-80 hover:opacity-100"
              >
                Tutup
              </button>
            </div>
          )}
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
          <div className="flex items-center gap-3">
            {lastSavedAt && !dirty && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-500"
                title={new Date(lastSavedAt).toLocaleString("id-ID")}
              >
                <Check className="h-3 w-3" aria-hidden="true" />
                Tersimpan · {formatRelative(now - lastSavedAt)}
              </span>
            )}
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
        </div>
        {lastSavedAt && (
          <p className="text-[11px] text-muted-foreground">
            Terakhir diperbarui{" "}
            <time dateTime={new Date(lastSavedAt).toISOString()}>
              {new Date(lastSavedAt).toLocaleString("id-ID", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function formatRelative(msAgo: number): string {
  if (msAgo < 45_000) return "baru saja";
  const min = Math.round(msAgo / 60_000);
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const d = Math.round(hr / 24);
  return `${d} hari lalu`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}