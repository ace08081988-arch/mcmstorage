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
      className="w-full border-b bg-background/80 backdrop-blur"
      style={{ borderBottomColor: "var(--primary)" }}
    >
      <div
        className={`mx-auto flex max-w-3xl items-center gap-ms-3 px-ms-4 ${
          compact ? "py-ms-2" : "py-ms-3"
        }`}
      >
        <Link to="/" className="flex items-center gap-ms-2 group" aria-label={full}>
          {logo ? (
            <img
              src={logo}
              alt={full}
              width={32}
              height={32}
              className="h-8 w-8 rounded-md object-cover"
            />
          ) : (
            <span
              className="flex h-8 w-8 items-center justify-center rounded-md text-ms-xs font-bold text-primary-foreground"
              style={{ backgroundColor: "var(--primary)" }}
            >
              {short}
            </span>
          )}
          <span className="text-ms-sm font-semibold tracking-tight group-hover:underline">
            {full}
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-x-2 text-ms-xs font-medium">
          <Link
            to="/produk"
            className="rounded-full px-ms-2.5 py-1 transition-colors hover:bg-primary/10 hover:text-primary"
          >
            Produk
          </Link>
          <Link
            to="/auth"
            className="rounded-full border border-primary/40 bg-primary/10 px-ms-3 py-1 font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            Masuk
          </Link>
        </nav>
      </div>
    </header>
  );
}