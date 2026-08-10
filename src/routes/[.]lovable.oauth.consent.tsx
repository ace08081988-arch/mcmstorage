import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Beta API — ekspor tipe supaya TS puas tanpa akses langsung ke node_modules.
type OAuthAuthorizationDetails = {
  client?: { name?: string | null; redirect_uri?: string | null } | null;
  scope?: string | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};
type OAuthResult<T> = { data: T | null; error: { message: string } | null };
type SupabaseOAuth = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult<OAuthAuthorizationDetails>>;
  approveAuthorization: (id: string) => Promise<OAuthResult<OAuthAuthorizationDetails>>;
  denyAuthorization: (id: string) => Promise<OAuthResult<OAuthAuthorizationDetails>>;
};
function oauth(): SupabaseOAuth {
  return (supabase.auth as unknown as { oauth: SupabaseOAuth }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // Session Supabase disimpan di localStorage — tidak tersedia di server.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      // Belum login: kirim ke /auth dan bawa balik ke URL consent dengan
      // authorization_id yang sama supaya provider bisa dilanjutkan.
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { redirect: next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId =
      new URLSearchParams(location.searchStr).get("authorization_id") ?? "";
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) {
      // Client sudah pernah disetujui — provider langsung memberi redirect.
      window.location.href = immediate;
    }
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md p-6 text-sm">
      Gagal memuat permintaan otorisasi:{" "}
      <span className="font-medium">
        {String((error as Error)?.message ?? error)}
      </span>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientName = details?.client?.name ?? "aplikasi eksternal";
  const redirectUri = details?.client?.redirect_uri ?? null;
  const scope = (details?.scope ?? "").trim();

  async function decide(approve: boolean) {
    setError(null);
    setBusy(true);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("Server otorisasi tidak mengembalikan URL tujuan.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight">
          Hubungkan {clientName} ke akun Ace Storage Anda
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {clientName} akan bisa memanggil tool Ace Storage sebagai Anda —
          semua akses tetap tunduk pada aturan keamanan aplikasi (RLS
          multi-tenant), jadi data tenant lain tidak dapat diakses.
        </p>

        <dl className="mt-4 space-y-2 rounded-lg bg-muted/50 p-3 text-xs">
          {redirectUri ? (
            <div className="flex flex-col">
              <dt className="font-medium text-muted-foreground">Kembali ke</dt>
              <dd className="break-all">{redirectUri}</dd>
            </div>
          ) : null}
          {scope ? (
            <div className="flex flex-col">
              <dt className="font-medium text-muted-foreground">Izin diminta</dt>
              <dd className="break-all">{scope}</dd>
            </div>
          ) : null}
        </dl>

        {error ? (
          <p role="alert" className="mt-3 rounded bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow disabled:opacity-60"
          >
            {busy ? "Memproses…" : "Izinkan"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-60"
          >
            Batalkan
          </button>
        </div>
      </div>
    </main>
  );
}