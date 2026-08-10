/**
 * Audit pratinjau WhatsApp (link preview) untuk daftar URL target.
 *
 * Crawler WhatsApp jauh lebih ketat dari Facebook/X:
 * - hanya membaca HTML awal (SSR), tidak menjalankan JS;
 * - hanya menerima og:image absolut https yang bisa diambil tanpa auth;
 * - menampilkan kartu besar hanya bila gambar cukup besar (>=200px) dan
 *   rasionya mendekati 1.91:1 (ideal 1200×630);
 * - meng-cache kartu berdasarkan URL gambar, jadi gambar yang bisa berubah
 *   WAJIB punya cache-buster (?v=…) agar pratinjau ikut segar.
 *
 * Modul ini murni: pemanggil (skrip CI) yang mengambil HTML dan menyelidiki
 * (probe) gambarnya.
 */
import { parseHead, normalizeUrl } from "./rendered-head-audit";
import { SITE_URL } from "./seo-meta";

export const WA_IDEAL_WIDTH = 1200;
export const WA_IDEAL_HEIGHT = 630;
/** Di bawah ini WhatsApp menampilkan thumbnail kecil, bukan kartu besar. */
export const WA_MIN_SIDE = 200;
/** WhatsApp menolak gambar yang terlalu berat untuk pratinjau. */
export const WA_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const WA_WARN_IMAGE_BYTES = 600 * 1024;

export type WaImageProbe = {
  url: string;
  status: number;
  contentType?: string | null;
  contentLength?: number | null;
  /** Tujuan akhir setelah redirect (endpoint OG kita memakai 302). */
  finalUrl?: string;
};

export type WaPreviewPage = {
  url: string;
  html: string;
  status?: number;
};

export type WaIssueId =
  | "http"
  | "og:title"
  | "og:description"
  | "og:image"
  | "og:image-absolute"
  | "og:image-https"
  | "og:image-fetch"
  | "og:image-type"
  | "og:image-size"
  | "og:image-dimensions"
  | "og:image-ratio"
  | "og:image-cache-buster"
  | "og:url"
  | "canonical"
  | "canonical-absolute"
  | "canonical-self";

export type WaIssue = {
  url: string;
  id: WaIssueId;
  level: "error" | "warning";
  message: string;
};

export type WaPreviewResult = {
  url: string;
  title: string | null;
  image: string | null;
  canonical: string | null;
  issues: WaIssue[];
};

export type WaPreviewReport = {
  ok: boolean;
  results: WaPreviewResult[];
  errors: WaIssue[];
  warnings: WaIssue[];
};

/** URL gambar punya cache-buster bila ada param versi atau nama berhash. */
export function hasCacheBuster(imageUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(imageUrl, SITE_URL);
  } catch {
    return false;
  }
  const versionParams = ["v", "ver", "version", "t", "rev", "updated"];
  for (const p of versionParams) {
    const val = u.searchParams.get(p);
    if (val && val.trim() !== "" && val !== "0") return true;
  }
  // Nama berkas berhash: logo.a1b2c3d4.png / og-1712345678.jpg
  const file = u.pathname.split("/").pop() ?? "";
  return /[.-][0-9a-f]{8,}\.(png|jpe?g|webp|gif|avif)$/i.test(file) || /\d{8,}\.(png|jpe?g|webp)$/i.test(file);
}

function num(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function auditWaPreview(
  page: WaPreviewPage,
  probe?: WaImageProbe | null,
  base = SITE_URL,
): WaPreviewResult {
  const issues: WaIssue[] = [];
  const add = (id: WaIssueId, level: WaIssue["level"], message: string) =>
    issues.push({ url: page.url, id, level, message });

  if (page.status !== undefined && (page.status < 200 || page.status >= 400)) {
    add("http", "error", `HTTP ${page.status} — crawler WA tidak bisa membaca halaman.`);
    return { url: page.url, title: null, image: null, canonical: null, issues };
  }

  const head = parseHead(page.html);
  const image = head.meta["og:image"] ?? null;
  const canonical = head.canonical;

  if (!head.meta["og:title"]) add("og:title", "error", "og:title kosong — kartu WA tanpa judul.");
  if (!head.meta["og:description"])
    add("og:description", "warning", "og:description kosong — kartu WA tanpa ringkasan.");

  if (!image) {
    add("og:image", "error", "og:image tidak ada — WA hanya menampilkan teks polos.");
  } else {
    if (!/^https?:\/\//i.test(image))
      add("og:image-absolute", "error", `og:image relatif (${image}); WA butuh URL absolut.`);
    else if (!/^https:\/\//i.test(image))
      add("og:image-https", "error", `og:image memakai http (${image}); WA hanya mengambil https.`);

    if (!hasCacheBuster(image))
      add(
        "og:image-cache-buster",
        "error",
        `og:image tanpa cache-buster (${image}); pratinjau lama akan menempel di cache WA.`,
      );

    const w = num(head.meta["og:image:width"]);
    const h = num(head.meta["og:image:height"]);
    if (!w || !h) {
      add("og:image-dimensions", "error", "og:image:width/height tidak diisi — WA sering jatuh ke kartu kecil.");
    } else {
      if (w < WA_MIN_SIDE || h < WA_MIN_SIDE)
        add("og:image-size", "error", `Dimensi ${w}×${h} di bawah ${WA_MIN_SIDE}px — WA memakai thumbnail kecil.`);
      const ratio = w / h;
      const ideal = WA_IDEAL_WIDTH / WA_IDEAL_HEIGHT;
      if (Math.abs(ratio - ideal) > 0.25)
        add(
          "og:image-ratio",
          "warning",
          `Rasio ${ratio.toFixed(2)}:1 jauh dari ideal ${ideal.toFixed(2)}:1 (${WA_IDEAL_WIDTH}×${WA_IDEAL_HEIGHT}); gambar akan dipotong.`,
        );
    }

    if (probe) {
      if (probe.status < 200 || probe.status >= 400)
        add("og:image-fetch", "error", `og:image tidak bisa diambil (HTTP ${probe.status}).`);
      else {
        const ct = probe.contentType ?? "";
        if (ct && !/^image\//i.test(ct))
          add("og:image-type", "error", `og:image bukan gambar (content-type: ${ct}).`);
        const bytes = probe.contentLength ?? null;
        if (bytes !== null && bytes > WA_MAX_IMAGE_BYTES)
          add("og:image-size", "error", `Berkas ${(bytes / 1024 / 1024).toFixed(1)}MB melebihi batas aman WA (5MB).`);
        else if (bytes !== null && bytes > WA_WARN_IMAGE_BYTES)
          add("og:image-size", "warning", `Berkas ${Math.round(bytes / 1024)}KB cukup berat; pratinjau WA lambat muncul.`);
      }
    }
  }

  if (!canonical) add("canonical", "error", "canonical tidak ada.");
  else if (!/^https?:\/\//i.test(canonical))
    add("canonical-absolute", "warning", `canonical relatif (${canonical}).`);
  else if (normalizeUrl(canonical, base) !== normalizeUrl(page.url, base))
    add(
      "canonical-self",
      "error",
      `canonical menunjuk ${canonical}, bukan halaman ini — WA akan memakai pratinjau URL lain.`,
    );

  const ogUrl = head.meta["og:url"];
  if (!ogUrl) add("og:url", "warning", "og:url kosong.");
  else if (canonical && normalizeUrl(ogUrl, base) !== normalizeUrl(canonical, base))
    add("og:url", "error", `og:url (${ogUrl}) tidak sama dengan canonical (${canonical}).`);

  return { url: page.url, title: head.title, image, canonical, issues };
}

export function auditWaPreviews(
  pages: WaPreviewPage[],
  probes: Record<string, WaImageProbe> = {},
  base = SITE_URL,
): WaPreviewReport {
  const results = pages.map((p) => {
    const img = parseHead(p.html).meta["og:image"];
    return auditWaPreview(p, img ? probes[img] : null, base);
  });
  const all = results.flatMap((r) => r.issues);
  const errors = all.filter((i) => i.level === "error");
  const warnings = all.filter((i) => i.level === "warning");
  return { ok: errors.length === 0, results, errors, warnings };
}

export function formatWaPreviewReport(report: WaPreviewReport): string {
  const lines: string[] = [];
  for (const r of report.results) {
    const bad = r.issues.filter((i) => i.level === "error").length;
    const warn = r.issues.filter((i) => i.level === "warning").length;
    const mark = bad ? "❌" : warn ? "⚠️" : "✅";
    lines.push(`${mark} ${r.url}`);
    if (r.image) lines.push(`   og:image ${r.image}`);
    for (const i of r.issues) lines.push(`   ${i.level === "error" ? "✗" : "•"} [${i.id}] ${i.message}`);
  }
  lines.push(
    report.ok
      ? `\n✅ Pratinjau WA siap publish — ${report.results.length} URL, ${report.warnings.length} peringatan.`
      : `\n❌ ${report.errors.length} masalah pratinjau WA pada ${report.results.length} URL (${report.warnings.length} peringatan).`,
  );
  return lines.join("\n");
}
