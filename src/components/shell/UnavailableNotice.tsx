import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowRight } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

/**
 * Lencana kecil "Tidak tersedia" — dipakai menempel di judul kartu/menu yang
 * belum punya data supaya jelas bukan error, hanya belum ada isinya.
 * Label dan ikonnya bisa diganti per halaman.
 */
export function UnavailableBadge({
  label = "Tidak tersedia",
  icon: Icon = AlertCircle,
  className = "",
}: {
  label?: string;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-ms-2xs font-medium text-muted-foreground ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}


/**
 * Konfigurasi satu tombol tujuan. Fleksibel: rute internal (`to` + search/
 * params/hash), tautan luar (`href`), atau aksi lokal (`onClick`).
 */
export type UnavailableTarget = {
  label: string;
  /** Rute internal TanStack Router. */
  to?: string;
  search?: Record<string, unknown>;
  params?: Record<string, unknown>;
  hash?: string;
  replace?: boolean;
  /** Tautan luar / non-router (mis. WhatsApp, unduhan langsung). */
  href?: string;
  /** Aksi lokal kalau tidak ada tujuan halaman. */
  onClick?: () => void;
  /** Tampilan tombol. Default: tombol pertama = primary. */
  variant?: "primary" | "secondary";
};

const BTN_BASE =
  "inline-flex min-h-11 items-center gap-2 rounded-xl px-ms-4 text-ms-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const BTN_VARIANT = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border border-border text-foreground hover:bg-muted/60",
} as const;

function TargetButton({
  target,
  fallbackVariant,
}: {
  target: UnavailableTarget;
  fallbackVariant: "primary" | "secondary";
}) {
  const cls = `${BTN_BASE} ${BTN_VARIANT[target.variant ?? fallbackVariant]}`;
  const inner = (
    <>
      {target.label}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </>
  );

  if (target.to) {
    return (
      <Link
        to={target.to}
        preload="intent"
        {...(target.search ? { search: target.search } : {})}
        {...(target.params ? { params: target.params } : {})}
        {...(target.hash ? { hash: target.hash } : {})}
        {...(target.replace ? { replace: true } : {})}
        className={cls}
      >
        {inner}
      </Link>
    );
  }

  if (target.href) {
    const external = /^https?:/i.test(target.href);
    return (
      <a
        href={target.href}
        className={cls}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {inner}
      </a>
    );
  }

  return (
    <button type="button" onClick={target.onClick} className={cls}>
      {inner}
    </button>
  );
}

/**
 * Panel "Tidak tersedia" + tombol menuju halaman yang benar.
 * Judul, pesan, ikon, catatan kecil, dan tujuan tombol semuanya bisa
 * dikustomisasi per halaman lewat props.
 */
export function UnavailableNotice({
  badgeLabel,
  title,
  icon,
  description,
  message,
  hint,
  actionLabel,
  to,
  search,
  params,
  hash,
  href,
  onAction,
  targets,
  children,
  className = "",
}: {
  /** Teks lencana kecil di atas. Default "Tidak tersedia". */
  badgeLabel?: string;
  /** Judul utama panel (opsional, tampil di bawah lencana). */
  title?: ReactNode;
  /** Ikon lencana (default AlertCircle). */
  icon?: ComponentType<{ className?: string }>;
  /** Pesan penjelas. `message` alias dari `description`. */
  description?: ReactNode;
  message?: ReactNode;
  /** Catatan kecil di bawah tombol, mis. syarat atau langkah berikutnya. */
  hint?: ReactNode;
  /** Bentuk ringkas: satu tombol. Diabaikan kalau `targets` diisi. */
  actionLabel?: string;
  to?: string;
  search?: Record<string, unknown>;
  params?: Record<string, unknown>;
  hash?: string;
  href?: string;
  onAction?: () => void;
  /** Bentuk fleksibel: daftar tujuan (tombol pertama = primary). */
  targets?: UnavailableTarget[];
  /** Konten tambahan bebas di bawah tombol. */
  children?: ReactNode;
  className?: string;
}) {
  const body = message ?? description;
  const list: UnavailableTarget[] =
    targets && targets.length > 0
      ? targets
      : actionLabel
        ? [{ label: actionLabel, to, search, params, hash, href, onClick: onAction }]
        : [];
  const badge = badgeLabel ?? "Tidak tersedia";
  // Hindari judul kembar kalau halaman mengirim title yang sama dengan lencana.
  const showTitle = Boolean(title) && !(typeof title === "string" && title.trim() === badge);



  return (
    <div
      role="status"
      className={`rounded-2xl border border-dashed border-border/70 bg-card/40 p-ms-4 text-center ${className}`}
    >
      <UnavailableBadge
        label={badge}
        {...(icon ? { icon } : {})}
      />
      {showTitle && (
        <h3 className="text-premium-heading mt-ms-2 text-ms-sm font-semibold leading-tight text-foreground">
          {title}
        </h3>
      )}

      {body && (
        <p className="mx-auto mt-ms-2 max-w-sm text-ms-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {body}
        </p>
      )}
      {list.length > 0 && (
        <div className="mt-ms-3 flex flex-wrap items-center justify-center gap-ms-2">
          {list.map((t, i) => (
            <TargetButton
              key={`${t.label}-${i}`}
              target={t}
              fallbackVariant={i === 0 ? "primary" : "secondary"}
            />
          ))}
        </div>
      )}
      {hint && (
        <p className="mx-auto mt-ms-2 max-w-sm text-ms-2xs leading-relaxed text-muted-foreground/80">
          {hint}
        </p>
      )}
      {children}
    </div>
  );

}

