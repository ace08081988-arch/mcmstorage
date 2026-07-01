import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, UserPlus, LogIn } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  addContactByInviteCode,
  formatInviteCode,
  normalizeInviteCode,
  resolveInviteCode,
  type InviteProfile,
} from "@/lib/invite";

/**
 * Deep link `/i/:code` — dibuka dari QR/link undangan. Bisa diakses tanpa
 * login: kalau belum masuk, tampilkan tombol Login (lalu balik ke sini).
 * Setelah login, PIN otomatis ditambahkan ke buku alamat.
 */
export const Route = createFileRoute("/i/$code")({
  component: InviteLandingPage,
});

function InviteLandingPage() {
  const { code: rawCode } = Route.useParams();
  const code = normalizeInviteCode(rawCode);
  const router = useRouter();

  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "not_found" }
    | { kind: "needs_auth"; profile: InviteProfile }
    | { kind: "ready"; profile: InviteProfile }
    | { kind: "error"; message: string }
  >({ kind: "loading" });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ data: userRes }, profile] = await Promise.all([
          supabase.auth.getUser(),
          resolveInviteCode(code).catch(() => null),
        ]);
        if (cancelled) return;
        if (!profile) {
          setState({ kind: "not_found" });
          return;
        }
        if (!userRes.user) {
          setState({ kind: "needs_auth", profile });
          return;
        }
        setState({ kind: "ready", profile });
      } catch (e) {
        if (!cancelled) setState({ kind: "error", message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function add() {
    if (state.kind !== "ready") return;
    setAdding(true);
    try {
      const r = await addContactByInviteCode(code);
      if (r.alreadyFriends) {
        toast.success(`Sudah berteman dengan ${r.displayName ?? "kontak"}.`);
        router.navigate({ to: "/chat" });
      } else if (r.incomingReverseId) {
        toast.info(`${r.displayName ?? "Kontak"} sudah lebih dulu mengundang kamu. Buka “Permintaan pertemanan” untuk menerima.`);
        router.navigate({ to: "/kontak/permintaan" as never });
      } else if (r.pending) {
        toast.success(
          r.alreadyExisted
            ? `Permintaan ke ${r.displayName ?? "kontak"} sudah dikirim — menunggu diterima.`
            : `Permintaan pertemanan terkirim ke ${r.displayName ?? "kontak"}. Menunggu diterima.`,
        );
        router.navigate({ to: "/kontak/permintaan" as never });
      } else {
        toast.info("Permintaan sudah tidak aktif.");
      }
    } catch (e) {
      toast.error((e as Error).message || "Gagal menambah kontak.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full rounded-2xl border bg-card p-6 shadow-sm">
        <div className="text-center text-xs uppercase tracking-wide text-muted-foreground">
          Undangan MCM Chat
        </div>
        <div className="mt-1 text-center font-mono text-lg tracking-widest">
          PIN {formatInviteCode(code)}
        </div>

        <div className="mt-6 min-h-[7rem]">
          {state.kind === "loading" && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Memeriksa PIN…
            </div>
          )}

          {state.kind === "not_found" && (
            <div className="text-center">
              <div className="text-base font-medium">PIN tidak ditemukan</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Kode mungkin salah ketik atau sudah tidak berlaku.
              </p>
            </div>
          )}

          {state.kind === "error" && (
            <div className="text-center text-sm text-destructive">{state.message}</div>
          )}

          {(state.kind === "ready" || state.kind === "needs_auth") && (
            <div className="flex flex-col items-center text-center">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-orange-950 text-2xl font-medium text-orange-300">
                {(state.profile.display_name || "?").trim()[0]?.toUpperCase() || "?"}
              </div>
              <div className="mt-3 text-lg font-semibold">
                {state.profile.display_name || "Tanpa nama"}
              </div>
              <div className="text-xs text-muted-foreground">
                {state.profile.chat_only ? "Akun Chat" : "Pengguna MCM"}
              </div>

              {state.kind === "ready" ? (
                <Button
                  type="button"
                  onClick={add}
                  disabled={adding}
                  className="mt-4 gap-2"
                >
                  <UserPlus className="h-4 w-4" />
                  {adding ? "Menambah…" : "Tambah ke kontak saya"}
                </Button>
              ) : (
                <Button asChild className="mt-4 gap-2">
                  <Link
                    to="/auth"
                    search={{ next: `/i/${code}` } as never}
                  >
                    <LogIn className="h-4 w-4" />
                    Masuk untuk menambah
                  </Link>
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 text-center text-xs text-muted-foreground">
          <Link to="/" className="text-primary underline">Beranda</Link>
        </div>
      </div>
    </main>
  );
}