import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Search, ShieldCheck, ShieldOff, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/friendly-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirm as confirmDialog } from "@/lib/confirm";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "Admin · Pengguna · MCM Storage" }] }),
  component: AdminUsersPage,
});

type Row = {
  user_id: string;
  email: string | null;
  created_at: string;
  is_admin: boolean;
  plan: string;
  status: string;
  period_end: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function AdminUsersPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        setIsAdmin(false);
        return;
      }
      setMe(u.user.id);
      const { data } = await supabase.rpc("has_role", {
        _user_id: u.user.id,
        _role: "admin",
      });
      setIsAdmin(!!data);
    })();
  }, []);

  const load = async (q: string = query) => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("admin_list_users", {
      _query: q.trim() || null,
      _limit: 100,
    });
    setLoading(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    setRows((data ?? []) as Row[]);
  };

  useEffect(() => {
    if (isAdmin) void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function toggleAdmin(r: Row) {
    if (r.user_id === me && r.is_admin) {
      toast.error("Tidak bisa mencabut role admin diri sendiri.");
      return;
    }
    const grant = !r.is_admin;
    const ok = await confirmDialog({
      title: grant ? "Jadikan admin?" : "Cabut role admin?",
      description: grant
        ? `${r.email ?? r.user_id} akan punya akses penuh ke halaman admin (pembayaran, pengguna, pengaturan).`
        : `${r.email ?? r.user_id} tidak lagi bisa membuka halaman admin.`,
      confirmText: grant ? "Jadikan admin" : "Cabut",
      destructive: !grant,
    });
    if (!ok) return;
    setBusyId(r.user_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("admin_set_admin_role", {
      _target: r.user_id,
      _grant: grant,
    });
    setBusyId(null);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    toast.success(grant ? "Role admin diberikan." : "Role admin dicabut.");
    void load();
  }

  if (isAdmin === null) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memeriksa akses…
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">Akses ditolak</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Halaman ini hanya untuk admin.
        </p>
        <Link to="/" className="mt-4 inline-block text-sm underline">
          Kembali ke beranda
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Admin · Pengguna</h1>
          <p className="text-xs text-muted-foreground">
            Cari akun berdasarkan email, dan kelola role admin.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link to="/admin/pembayaran" className="rounded-md border px-3 py-1.5 hover:bg-muted">
            Pembayaran →
          </Link>
        </div>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari email…"
            className="pl-8"
          />
        </div>
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cari"}
        </Button>
        <Button type="button" variant="outline" onClick={() => void load("")} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Daftar</th>
              <th className="px-3 py-2 text-left">Paket</th>
              <th className="px-3 py-2 text-left">Periode</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Tidak ada pengguna ditemukan.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isSelf = r.user_id === me;
              return (
                <tr key={r.user_id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.email ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground">{r.user_id}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{formatDate(r.created_at)}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="rounded bg-muted px-1.5 py-0.5">{r.plan}</span>
                    <span className="ml-1 text-muted-foreground">/ {r.status}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{formatDate(r.period_end)}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.is_admin ? (
                      <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                        <ShieldCheck className="h-3 w-3" /> admin
                      </span>
                    ) : (
                      <span className="text-muted-foreground">user</span>
                    )}
                    {isSelf && <span className="ml-1 text-[10px] text-muted-foreground">(Anda)</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      variant={r.is_admin ? "outline" : "default"}
                      disabled={busyId === r.user_id || (isSelf && r.is_admin)}
                      onClick={() => void toggleAdmin(r)}
                    >
                      {busyId === r.user_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : r.is_admin ? (
                        <>
                          <ShieldOff className="mr-1 h-3.5 w-3.5" /> Cabut admin
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Jadikan admin
                        </>
                      )}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Catatan: peran admin memberikan akses ke pengaturan pembayaran, harga bank, dan
        persetujuan transfer. Berikan hanya kepada orang yang Anda percayai sepenuhnya.
      </p>
    </div>
  );
}