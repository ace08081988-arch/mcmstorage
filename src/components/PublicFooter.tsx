import { Link } from "@tanstack/react-router";

export function PublicFooter() {
  return (
    <footer className="mt-10 border-t border-border bg-muted/30">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()} <strong>BAROKAH RIZKI</strong> — dioperasikan
          sebagai MCM Storage.
        </p>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link to="/pricing" className="hover:underline">
            Harga
          </Link>
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