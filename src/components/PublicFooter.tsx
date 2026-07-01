import { Link } from "@tanstack/react-router";
import { useOrgName } from "@/lib/org-name";

export function PublicFooter() {
  const { full, short, logo } = useOrgName();
  return (
    <footer
      className="mt-10 border-t bg-muted/30"
      style={{ borderTopColor: "var(--primary)" }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {logo ? (
            <img
              src={logo}
              alt={full}
              width={24}
              height={24}
              className="h-6 w-6 rounded object-cover"
            />
          ) : (
            <span
              className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold text-primary-foreground"
              style={{ backgroundColor: "var(--primary)" }}
            >
              {short}
            </span>
          )}
          <p>
            © {new Date().getFullYear()} <strong>{full}</strong>
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link to="/terms" className="hover:underline">
            Syarat &amp; Ketentuan
          </Link>
          <Link to="/refund" className="hover:underline">
            Kebijakan Pengembalian
          </Link>
          <Link to="/trust" className="hover:underline">
            Privasi
          </Link>
        </nav>
      </div>
    </footer>
  );
}