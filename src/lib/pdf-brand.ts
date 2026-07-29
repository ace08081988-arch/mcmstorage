/**
 * Kop resmi PDF: logo + nama bisnis, dipakai semua modul ekspor PDF
 * supaya dokumen terlihat konsisten dan resmi di setiap halaman.
 */
import { getOrgName, getOrgLogo, getOrgBrand } from "@/lib/org-name";

type Logo = { data: string; fmt: "PNG" | "JPEG"; w: number; h: number };

/** Ambil logo sebagai data URL (aman untuk data URL maupun URL remote). */
export async function loadOrgLogo(src = getOrgLogo()): Promise<Logo | null> {
  if (!src) return null;
  try {
    let dataUrl = src;
    if (!src.startsWith("data:")) {
      const res = await fetch(src, { mode: "cors" });
      if (!res.ok) return null;
      const blob = await res.blob();
      dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("read fail"));
        fr.readAsDataURL(blob);
      });
    }
    const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      img.onerror = () => reject(new Error("img fail"));
      img.src = dataUrl;
    });
    const fmt: Logo["fmt"] = /^data:image\/jpe?g/i.test(dataUrl) ? "JPEG" : "PNG";
    return { data: dataUrl, fmt, w: dims.w, h: dims.h };
  } catch {
    return null;
  }
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Minimal jsPDF surface yang dipakai kop. */
type Doc = {
  internal: { pageSize: { getWidth: () => number } };
  setFillColor: (r: number, g: number, b: number) => void;
  rect: (x: number, y: number, w: number, h: number, s: string) => void;
  addImage: (...a: unknown[]) => void;
  setTextColor: (...a: number[]) => void;
  setFontSize: (n: number) => void;
  text: (t: string, x: number, y: number, o?: Record<string, unknown>) => void;
};

export type BrandHeader = {
  bandH: number;
  orgName: string;
  brand: [number, number, number];
  draw: () => void;
};

/**
 * Siapkan kop bermerek. Panggil `draw()` sekali per halaman
 * (mis. di `didDrawPage` autoTable atau setelah `addPage()`).
 */
export async function prepareBrandHeader(
  doc: Doc,
  opts: { marginX?: number; subtitle?: string } = {},
): Promise<BrandHeader> {
  const marginX = opts.marginX ?? 40;
  const bandH = 46;
  const orgName = getOrgName();
  const logo = await loadOrgLogo();
  const brand = hexToRgb(getOrgBrand()) ?? ([49, 46, 129] as [number, number, number]);
  const pageW = doc.internal.pageSize.getWidth();

  const draw = () => {
    doc.setFillColor(brand[0], brand[1], brand[2]);
    doc.rect(0, 0, pageW, bandH, "F");
    let tx = marginX;
    if (logo) {
      const h = bandH - 16;
      const w = Math.min(h * (logo.w / logo.h), 90);
      try {
        doc.addImage(logo.data, logo.fmt, marginX, (bandH - h) / 2, w, h, undefined, "FAST");
        tx = marginX + w + 10;
      } catch { /* logo gagal dimuat — lanjut tanpa logo */ }
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.text(orgName, tx, bandH / 2 + 1, { baseline: "middle" });
    if (opts.subtitle !== "") {
      doc.setFontSize(8);
      doc.text(opts.subtitle ?? "Laporan resmi", pageW - marginX, bandH / 2 + 1, {
        align: "right",
        baseline: "middle",
      });
    }
    doc.setTextColor(0);
  };

  return { bandH, orgName, brand, draw };
}
