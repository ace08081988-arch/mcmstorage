import { Link } from "@tanstack/react-router";
import { useOrgName } from "@/lib/org-name";

/**
 * Compact branded strip for public pages (auth, terms, trust, refund, dll).
 * Menampilkan logo (atau badge singkatan) + nama organisasi dengan aksen
 * warna brand di border bawah agar konsisten dengan header sidebar & footer.
 */
export function PublicHeader({ compact = false }: { compact?: boolean }) {
  const { full, short, logo } = useOrgName();
  return (
    <header
      className="app-safe-top app-safe-x sticky top-0 z-40 w-full border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70"
      style={{ borderBottomColor: "var(--primary)" }}
    >
      <div
        className={`mx-auto flex max-w-3xl items-center gap-ms-2 px-ms-4 ${
          compact ? "py-ms-2" : "py-ms-3"
        }`}
      >
        <Link
          to="/"
          className="group flex min-w-0 shrink items-center gap-ms-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          aria-label={full}
        >
          {logo ? (
            <img
              src={logo}
              alt={full}
              width={32}
              height={32}
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              className="h-8 w-8 shrink-0 rounded-md object-cover"
            />
          ) : (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ms-xs font-bold text-primary-foreground"
              style={{ backgroundColor: "var(--primary)" }}
            >
              {short}
            </span>
          )}
          {/* Nama panjang disembunyikan di layar <380px supaya menu navigasi
              tidak terdesak / brand tidak pecah dua baris. */}
          <span className="hidden min-w-0 truncate text-ms-sm font-semibold tracking-tight group-hover:underline min-[380px]:inline-block">
            {full}
          </span>
        </Link>
        <nav className="ml-auto flex shrink-0 items-center gap-x-1 text-ms-xs font-medium sm:gap-x-2">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeProps={{ className: "bg-primary/12 text-primary" }}
              className="inline-flex min-h-[var(--ms-tap)] items-center rounded-xl px-ms-2 outline-none transition-colors hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/60 sm:px-ms-2.5"
            >
              {item.label}
            </Link>
          ))}
          <Link
            to="/auth"
            className="inline-flex min-h-[var(--ms-tap)] items-center rounded-xl border border-primary/40 bg-primary/10 px-ms-2.5 font-semibold text-primary outline-none transition-colors hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-primary/60 sm:px-ms-3"
          >
            Masuk
          </Link>
        </nav>
      </div>
    </header>
  );
}