/**
 * Audit metadata SEO per-rute publik.
 *
 * Memeriksa bahwa setiap rute publik (yang bisa dibuka tanpa login dan layak
 * diindeks) mendeklarasikan `head()` dengan: title, description, og:title,
 * og:description, og:image, twitter:card, dan `<link rel="canonical">`.
 *
 * Modul ini murni (tanpa I/O): pemanggil menyuntikkan daftar file rute beserta
 * sumbernya, sehingga bisa dipakai dari unit test (fs) maupun skrip CI.
 *
 * Rute yang memakai helper SSOT `socialMeta()` dari `@/lib/seo-meta` otomatis
 * dianggap memenuhi seluruh tag meta, karena helper itu selalu memancarkan
 * paket lengkap OG + Twitter. Rute yang menulis meta manual diperiksa
 * tag-per-tag.
 */

import { DEFAULT_AUDIT_POLICY, isUrlAudited, type AuditPolicy } from "./seo-audit-policy";

export type RouteSource = {
  /** Nama file relatif terhadap `src/routes`, mis. "faq.tsx". */
  file: string;
  source: string;
};

export type RouteSeoIssue = {
  route: string;
  file: string;
  id:
    | "head-missing"
    | "title"
    | "description"
    | "og:title"
    | "og:description"
    | "og:image"
    | "og:image-dimensions"
    | "twitter:card"
    | "canonical"
    | "canonical-self";
  message: string;
};

export type RouteSeoReport = {
  ok: boolean;
  /** Rute publik yang diperiksa (terurut). */
  audited: string[];
  /** Rute non-publik / internal yang sengaja dilewati (terurut). */
  skipped: string[];
  issues: RouteSeoIssue[];
};

/** Prefiks nama file rute yang bukan halaman publik terindeks. */
const SKIP_PREFIXES = [
  "_authenticated", // butuh login
  "-_authenticated", // file test bersebelahan
  "lovable", // harness visual/internal
  "[.]", // well-known & sejenisnya
  "api", // endpoint HTTP
  "email", // template email
  "__root", // layout, bukan halaman
];

/** Nama file spesifik yang bukan halaman HTML terindeks. */
const SKIP_FILES = new Set([
  "sitemap[.]xml.ts",
  "mcp.ts",
  "auth-callback.tsx",
  "error.tsx",
  "reset-password.tsx",
  "pratinjau-tema.tsx",
  "diagnostik.paket.tsx",
  "i.$code.tsx", // redirect undangan
  "t.$token.tsx", // portal pegawai bertoken (noindex)
]);

export function isPublicRouteFile(file: string): boolean {
  if (!/\.tsx?$/.test(file)) return false;
  if (/\.test\.tsx?$/.test(file)) return false;
  if (SKIP_FILES.has(file)) return false;
  return !SKIP_PREFIXES.some((p) => file.startsWith(p));
}

/** Ubah nama file rute jadi path URL, mengikuti konvensi TanStack Router. */
export function routePathFromFile(file: string): string {
  const base = file.replace(/\.tsx?$/, "");
  const segments = base
    .split(".")
    .filter((s) => s !== "index")
    .map((s) => s.replace(/^\[(.+)\]$/, "$1"));
  return `/${segments.join("/")}`.replace(/\/+$/, "") || "/";
}

function hasTag(source: string, key: string, value: "property" | "name"): boolean {
  const attr = value === "property" ? "property" : "name";
  const re = new RegExp(`${attr}:\\s*["'\`]${key.replace(/[$.*+?^{}()|[\\]\\\\]/g, "\\\\$&")}["'\`]`);
  return re.test(source) || new RegExp(`["'\`]${key}["'\`]\\s*:`).test(source);
}

/** Ambil isi blok `head:` dari sumber rute (heuristik penyeimbang kurung). */
export function extractHeadBlock(source: string): string | null {
  const idx = source.search(/\bhead\s*:\s*\(/);
  if (idx === -1) return null;
  // Lewati daftar parameter arrow (`({ params, loaderData }) =>`) supaya
  // destructuring tidak dianggap sebagai akhir blok.
  const arrow = source.indexOf("=>", idx);
  const start = arrow === -1 ? idx : arrow + 2;
  let depth = 0;
  let sawBrace = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "{") {
      depth++;
      if (ch === "{") sawBrace = true;
    } else if (ch === ")" || ch === "}") {
      depth--;
      if (sawBrace && depth <= 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

/** Ubah path rute (`/katalog/$slug`) jadi pola glob (`/katalog/*`). */
export function routeGlobPath(route: string): string {
  return route.replace(/\$[^/]+/g, "*");
}

export function auditRouteSeo(
  routes: RouteSource[],
  policy: AuditPolicy = DEFAULT_AUDIT_POLICY,
): RouteSeoReport {
  const issues: RouteSeoIssue[] = [];
  const audited: string[] = [];
  const skipped: string[] = [];

  for (const { file, source } of [...routes].sort((a, b) => a.file.localeCompare(b.file))) {
    if (!isPublicRouteFile(file)) {
      if (/\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)) skipped.push(file);
      continue;
    }
    const route = routePathFromFile(file);

    // Whitelist/blacklist: rute yang sengaja berbeda tidak diaudit.
    if (!isUrlAudited(routeGlobPath(route), policy)) {
      skipped.push(file);
      continue;
    }

    const head = extractHeadBlock(source);

    // Rute layout (hanya membungkus <Outlet />) tidak punya metadata sendiri;
    // anak `*.index.tsx`-nya yang diaudit.
    if (/<Outlet\s*\/?>/.test(source)) {
      skipped.push(file);
      continue;
    }

    audited.push(route);
    const add = (id: RouteSeoIssue["id"], message: string) =>
      issues.push({ route, file, id, message });

    if (!head) {
      add("head-missing", "tidak punya head() — metadata SEO jatuh ke default root");
      continue;
    }

    // Halaman yang sengaja disembunyikan dari mesin pencari tidak wajib
    // punya kartu sosial lengkap, tapi tetap wajib punya title.
    const noindex = /noindex/.test(head);
    const usesSocialMeta = /socialMeta\s*\(/.test(head);

    if (!usesSocialMeta) {
      if (!/\btitle\s*:/.test(head)) add("title", "meta title tidak ditemukan");
      if (!hasTag(head, "description", "name"))
        add("description", "meta description tidak ditemukan");
      if (!noindex) {
        if (!hasTag(head, "og:title", "property")) add("og:title", "og:title tidak ditemukan");
        if (!hasTag(head, "og:description", "property"))
          add("og:description", "og:description tidak ditemukan");
        if (!hasTag(head, "og:image", "property")) add("og:image", "og:image tidak ditemukan");
        else {
          const missing = [
            "og:image:secure_url",
            "og:image:width",
            "og:image:height",
            "og:image:type",
          ].filter((tag) => !hasTag(head, tag, "property"));
          if (missing.length)
            add(
              "og:image-dimensions",
              `og:image dideklarasikan manual tetapi kurang ${missing.join(", ")} — pakai socialMeta() dari @/lib/seo-meta`,
            );
        }
        if (!hasTag(head, "twitter:card", "name"))
          add("twitter:card", "twitter:card tidak ditemukan");
      }
    }

    if (!noindex) {
      const hasCanonical = /canonical/.test(head);
      if (!hasCanonical) {
        add("canonical", "link rel=canonical tidak ditemukan");
      } else if (/canonical\s*\(\s*["'`](\/[^"'`]*)["'`]\s*\)/.test(head)) {
        const target = head.match(/canonical\s*\(\s*["'`](\/[^"'`]*)["'`]\s*\)/)![1];
        // Template literal `/download/${params.variant}` disetarakan dengan
        // segmen dinamis rute `$variant`.
        const normalized = target.replace(/\$\{[^}]*\.(\w+)\}/g, "$$$1");
        if (normalized !== route) {
          add(
            "canonical-self",
            `canonical menunjuk "${target}" padahal rute ini "${route}" — harus self-referensial`,
          );
        }
      }
    }
  }

  issues.sort((a, b) => a.route.localeCompare(b.route) || a.id.localeCompare(b.id));
  return { ok: issues.length === 0, audited: audited.sort(), skipped: skipped.sort(), issues };
}

export function formatRouteSeoAudit(report: RouteSeoReport): string {
  if (report.ok) return `SEO rute OK — ${report.audited.length} rute publik diperiksa.`;
  return [
    `SEO rute: ${report.issues.length} masalah pada ${report.audited.length} rute publik.`,
    ...report.issues.map((i) => `  • ${i.route} (${i.file}) — ${i.id}: ${i.message}`),
  ].join("\n");
}