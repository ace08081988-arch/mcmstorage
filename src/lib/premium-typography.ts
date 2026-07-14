/**
 * Premium++ typography helpers (Slice 0).
 *
 * Class-name konstanta supaya adopsi bertahap per rute operasional konsisten.
 * Warna TIDAK di-hardcode — semua tetap mengikuti preset user (`text-foreground`,
 * `text-primary`, dll.). Utility di sini hanya menambah lapisan tipografi &
 * elevasi. Impor dari `@/lib/premium-typography` di komponen yang siap.
 *
 * Contoh:
 *   <h1 className={premiumHeading("text-ms-3xl text-foreground")}>Judul</h1>
 *   <section className={premiumCard()}>...</section>
 */
import { cn } from "@/lib/utils";

/** Judul halaman/section — display serif dengan tracking rapat. */
export const premiumHeading = (...extra: Array<string | false | null | undefined>) =>
  cn("text-premium-heading", ...extra);

/** Kartu utama — permukaan berlapis dengan shadow halus, radius konsisten. */
export const premiumCard = (...extra: Array<string | false | null | undefined>) =>
  cn("surface-elevated", ...extra);

/** Kartu utama versi lebih tinggi (modal/sheet/hero card). */
export const premiumCardLg = (...extra: Array<string | false | null | undefined>) =>
  cn("surface-elevated-lg", ...extra);

/** CTA lift halus — otomatis nonaktif pada `prefers-reduced-motion`. */
export const premiumLift = (...extra: Array<string | false | null | undefined>) =>
  cn("lift-on-hover shadow-elevate", ...extra);

/** Ring aksen (fokus / seleksi menonjol) — mengikuti `--primary` preset user. */
export const premiumRing = (...extra: Array<string | false | null | undefined>) =>
  cn("ring-premium", ...extra);