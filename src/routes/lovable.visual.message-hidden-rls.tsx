/**
 * Harness E2E untuk memverifikasi bahwa role `authenticated` bisa
 * membaca tabel `message_hidden` (SELECT) dan memanggil RPC
 * `message_hide_for_me` — jadi kalau GRANT/policy pernah bergeser dan
 * memicu "permission denied", test langsung merah.
 *
 * Butuh sesi login (storageState `tests/visual/.auth/user.json`).
 * URL: /lovable/visual/message-hidden-rls
 * Tidak diindeks, murni instrumen test.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Result = {
  authed: boolean;
  userId: string | null;
  selectOk: boolean;
  selectError: string | null;
  rpcError: string | null;
  rpcPermissionDenied: boolean;
};

// UUID dummy — pesan tidak ada di DB, jadi RPC akan gagal validasi (bukan
// permission). Kalau RLS/GRANT rusak, error-nya berbunyi "permission denied".
const BOGUS_MSG_ID = "00000000-0000-0000-0000-000000000000";

function isPermissionDenied(msg: string | null | undefined) {
  if (!msg) return false;
  return /permission denied|not authorized|rls/i.test(msg);
}

function Harness() {
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setResult(null);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    const sel = await supabase
      .from("message_hidden")
      .select("message_id")
      .limit(1);

    const rpc = await supabase.rpc("message_hide_for_me", {
      _msg: BOGUS_MSG_ID,
    });

    setResult({
      authed: !!userId,
      userId,
      selectOk: !sel.error,
      selectError: sel.error?.message ?? null,
      rpcError: rpc.error?.message ?? null,
      rpcPermissionDenied: isPermissionDenied(rpc.error?.message),
    });
    setRunning(false);
  }

  return (
    <div className="p-6 space-y-4 max-w-xl mx-auto">
      <h1 className="text-lg font-semibold">message_hidden RLS/GRANT check</h1>
      <Button data-testid="run-check" onClick={run} disabled={running}>
        {running ? "Running…" : "Run check"}
      </Button>
      {result && (
        <dl
          className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm"
          data-testid="result-block"
        >
          <dt>authed</dt>
          <dd data-testid="authed">{String(result.authed)}</dd>
          <dt>userId</dt>
          <dd data-testid="user-id">{result.userId ?? "-"}</dd>
          <dt>selectOk</dt>
          <dd data-testid="select-ok">{String(result.selectOk)}</dd>
          <dt>selectError</dt>
          <dd data-testid="select-error">{result.selectError ?? "-"}</dd>
          <dt>rpcError</dt>
          <dd data-testid="rpc-error">{result.rpcError ?? "-"}</dd>
          <dt>rpcPermissionDenied</dt>
          <dd data-testid="rpc-permission-denied">
            {String(result.rpcPermissionDenied)}
          </dd>
        </dl>
      )}
    </div>
  );
}

export const Route = createFileRoute("/lovable/visual/message-hidden-rls")({
  head: () => ({
    meta: [
      { title: "Harness · message_hidden RLS" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Harness,
});