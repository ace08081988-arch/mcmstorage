/**
 * Validasi berkas og:image yang sesungguhnya (bukan sekadar tag head).
 *
 * Kontrak deploy: setiap route publik merujuk og:image PNG 1200×630 yang
 * merespons HTTP 200. Tag `og:image:width/height` bisa saja berbohong — di
 * sini byte gambarnya yang dibaca, jadi kartu WhatsApp/Facebook dijamin utuh.
 *
 * Murni tanpa I/O: pemanggil yang mengambil byte-nya (cukup ~64 byte pertama).
 */
import { isIssueExempt, type AuditPolicy, DEFAULT_AUDIT_POLICY } from "./seo-audit-policy";

export const OG_REQUIRED_WIDTH = 1200;
export const OG_REQUIRED_HEIGHT = 630;
export const OG_REQUIRED_FORMAT = "png";

export type ImageFormat = "png" | "jpeg" | "webp" | "gif" | "avif" | "unknown";

export type SniffedImage = {
  format: ImageFormat;
  width: number | null;
  height: number | null;
};

const u32 = (b: Uint8Array, o: number) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
const ascii = (b: Uint8Array, o: number, n: number) =>
  String.fromCharCode(...Array.from(b.slice(o, o + n)));

/** Baca format + dimensi dari header berkas (PNG/JPEG/WebP/GIF). */
export function sniffImage(bytes: Uint8Array): SniffedImage {
  if (bytes.length >= 24 && ascii(bytes, 1, 3) === "PNG" && ascii(bytes, 12, 4) === "IHDR") {
    return { format: "png", width: u32(bytes, 16) >>> 0, height: u32(bytes, 20) >>> 0 };
  }
  if (bytes.length >= 6 && ascii(bytes, 0, 3) === "GIF") {
    return { format: "gif", width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const kind = ascii(bytes, 12, 4);
    if (kind === "VP8X")
      return {
        format: "webp",
        width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
        height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
      };
    if (kind === "VP8 ")
      return { format: "webp", width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
    if (kind === "VP8L") {
      const b = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return { format: "webp", width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    return { format: "webp", width: null, height: null };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) { o++; continue; }
      const marker = bytes[o + 1];
      const len = (bytes[o + 2] << 8) | bytes[o + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: "jpeg", height: (bytes[o + 5] << 8) | bytes[o + 6], width: (bytes[o + 7] << 8) | bytes[o + 8] };
      }
      o += 2 + len;
    }
    return { format: "jpeg", width: null, height: null };
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp" && /avif|avis/.test(ascii(bytes, 8, 4)))
    return { format: "avif", width: null, height: null };
  return { format: "unknown", width: null, height: null };
}

export type OgImageFetch = {
  /** URL route yang merujuk gambar ini. */
  routeUrl: string;
  imageUrl: string | null;
  status: number;
  contentType?: string | null;
  /** Beberapa KB pertama berkas; cukup untuk membaca header. */
  bytes?: Uint8Array | null;
};

export type OgImageIssueId =
  | "og:image-missing"
  | "og:image-status"
  | "og:image-content-type"
  | "og:image-format"
  | "og:image-unreadable"
  | "og:image-dimensions";

export type OgImageIssue = {
  routeUrl: string;
  imageUrl: string | null;
  id: OgImageIssueId;
  message: string;
};

export type OgImageReport = {
  ok: boolean;
  checked: number;
  issues: OgImageIssue[];
  exempt: OgImageIssue[];
};

export function validateOgImage(fetched: OgImageFetch): OgImageIssue[] {
  const issues: OgImageIssue[] = [];
  const add = (id: OgImageIssueId, message: string) =>
    issues.push({ routeUrl: fetched.routeUrl, imageUrl: fetched.imageUrl, id, message });

  if (!fetched.imageUrl) {
    add("og:image-missing", "Route tidak merujuk og:image apa pun.");
    return issues;
  }
  if (fetched.status !== 200) {
    add("og:image-status", `HTTP ${fetched.status} (wajib 200).`);
    return issues;
  }
  const ct = (fetched.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (ct && ct !== "image/png") add("og:image-content-type", `content-type ${ct}, wajib image/png.`);

  const bytes = fetched.bytes;
  if (!bytes || bytes.length < 24) {
    add("og:image-unreadable", "Header berkas tidak terbaca; dimensi tidak bisa diverifikasi.");
    return issues;
  }
  const info = sniffImage(bytes);
  if (info.format !== OG_REQUIRED_FORMAT)
    add("og:image-format", `Format berkas ${info.format}, wajib PNG.`);
  if (info.width !== OG_REQUIRED_WIDTH || info.height !== OG_REQUIRED_HEIGHT)
    add(
      "og:image-dimensions",
      `Dimensi ${info.width ?? "?"}×${info.height ?? "?"}, wajib ${OG_REQUIRED_WIDTH}×${OG_REQUIRED_HEIGHT}.`,
    );
  return issues;
}

export function validateOgImages(
  fetched: OgImageFetch[],
  policy: AuditPolicy = DEFAULT_AUDIT_POLICY,
): OgImageReport {
  const all = fetched.flatMap(validateOgImage);
  const exempt = all.filter((i) => isIssueExempt(i.routeUrl, i.id, policy));
  const issues = all.filter((i) => !exempt.includes(i));
  return { ok: issues.length === 0, checked: fetched.length, issues, exempt };
}

export function formatOgImageReport(report: OgImageReport): string {
  const lines = report.issues.map((i) => `   ✗ ${i.routeUrl}\n      [${i.id}] ${i.message}${i.imageUrl ? `\n      ${i.imageUrl}` : ""}`);
  if (report.exempt.length)
    lines.push(`   ↷ ${report.exempt.length} temuan dikecualikan kebijakan (${[...new Set(report.exempt.map((e) => e.routeUrl))].join(", ")})`);
  lines.push(
    report.ok
      ? `\n✅ og:image valid PNG ${OG_REQUIRED_WIDTH}×${OG_REQUIRED_HEIGHT} & HTTP 200 pada ${report.checked} route.`
      : `\n❌ ${report.issues.length} masalah og:image pada ${report.checked} route.`,
  );
  return lines.join("\n");
}
