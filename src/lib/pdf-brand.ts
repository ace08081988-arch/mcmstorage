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
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
  setFillColor: (r: number, g: number, b: number) => unknown;
  rect: (x: number, y: number, w: number, h: number, s?: string) => unknown;
  addImage: (
    data: string,
    fmt: string,
    x: number,
    y: number,
    w: number,
    h: number,
    alias?: string,
    compression?: "NONE" | "FAST" | "MEDIUM" | "SLOW",
  ) => unknown;
  setTextColor: (r: number, g?: number, b?: number) => unknown;
  setFontSize: (n: number) => unknown;
  text: (t: string, x: number, y: number, o?: Record<string, unknown>) => unknown;
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
  opts: { marginX?: number; subtitle?: string; docNumber?: string } = {},
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
    if (opts.docNumber) {
      doc.setFontSize(8);
      doc.text(`No. ${opts.docNumber}`, pageW - marginX, bandH / 2 - 5, {
        align: "right",
        baseline: "middle",
      });
      doc.setFontSize(7.5);
      doc.text(opts.subtitle ?? "Dokumen resmi", pageW - marginX, bandH / 2 + 8, {
        align: "right",
        baseline: "middle",
      });
    } else if (opts.subtitle !== "") {
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

/** Doc surface tambahan untuk blok tanda tangan. */
type SignDoc = Doc & {
  setDrawColor: (r: number, g?: number, b?: number) => unknown;
  setLineWidth?: (n: number) => unknown;
  line: (x1: number, y1: number, x2: number, y2: number) => unknown;
  setFont?: (name: string, style?: string) => unknown;
  getNumberOfPages?: () => number;
  setPage?: (n: number) => unknown;
};

export type SignatureBlockOptions = {
  marginX?: number;
  /** Batas bawah konten (footer nomor halaman). Default 46. */
  marginBottom?: number;
  /** Skala font mengikuti preferensi PDF pengguna. */
  fontScale?: number;
  /** Kota/tempat penandatanganan, mis. "Surabaya". */
  place?: string;
  /** Tanggal dokumen. Default: sekarang. */
  date?: Date;
  /** Label peran penandatangan. Default "Admin". */
  role?: string;
  /** Nama penandatangan bila diketahui; kosong = garis titik-titik. */
  signerName?: string;
  /** Y awal blok (pt). Bila kurang ruang, blok ditempel di atas footer. */
  startY?: number;
  /** Nomor dokumen otomatis, dicetak di sisi kiri blok tanda tangan. */
  docNumber?: string;
};

/**
 * Ruang tanda tangan admin + tanggal di footer halaman terakhir,
 * supaya dokumen ekspor siap dicetak, ditandatangani, dan dicap sebagai bukti.
 * Mengembalikan Y akhir blok.
 */
export function drawSignatureBlock(doc: SignDoc, opts: SignatureBlockOptions = {}): number {
  const marginX = opts.marginX ?? 40;
  const marginBottom = opts.marginBottom ?? 46;
  const fs = opts.fontScale ?? 1;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const date = opts.date ?? new Date();
  const role = opts.role ?? "Admin";

  const blockH = 96;
  const bottomLimit = pageH - marginBottom;
  let y = opts.startY != null ? opts.startY + 24 : bottomLimit - blockH;
  if (y + blockH > bottomLimit) y = bottomLimit - blockH;

  const colW = 200;
  const colX = pageW - marginX - colW;
  const tanggal = date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  doc.setTextColor(60);
  doc.setFontSize(9.5 * fs);
  doc.text(`${opts.place ? `${opts.place}, ` : ""}${tanggal}`, colX + colW, y, { align: "right" });
  doc.text("Disiapkan & disetujui,", colX + colW, y + 14, { align: "right" });

  // Ruang kosong untuk tanda tangan + cap
  const lineY = y + 72;
  doc.setDrawColor(150);
  doc.setLineWidth?.(0.7);
  doc.line(colX, lineY, colX + colW, lineY);

  doc.setTextColor(20);
  doc.setFontSize(10 * fs);
  doc.setFont?.("helvetica", "bold");
  doc.text(opts.signerName || "(  .................................  )", colX + colW, lineY + 14, {
    align: "right",
  });
  doc.setFont?.("helvetica", "normal");
  doc.setTextColor(110);
  doc.setFontSize(8.5 * fs);
  doc.text(role, colX + colW, lineY + 26, { align: "right" });

  // Sisi kiri: catatan cap resmi
  doc.setTextColor(140);
  doc.setFontSize(8 * fs);
  doc.text("Cap / stempel:", marginX, y + 14);
  doc.setDrawColor(200);
  doc.rect(marginX, y + 22, 108, 62);
  if (opts.docNumber) {
    doc.setTextColor(110);
    doc.setFontSize(8 * fs);
    doc.text(`No. dokumen: ${opts.docNumber}`, marginX, y + 96);
  }

  doc.setTextColor(0);
  return lineY + 30;
}
