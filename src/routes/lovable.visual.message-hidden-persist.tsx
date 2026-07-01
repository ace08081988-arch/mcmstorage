/**
 * Harness integrasi untuk kontrak "hapus pesan harus tetap tersembunyi
 * setelah refresh". Skenario:
 *
 *  1. Ambil satu message_id yang benar-benar bisa dilihat user saat ini.
 *  2. Panggil RPC `message_hide_for_me` (jalur yang dipakai UI).
 *  3. SELECT `message_hidden` — id harus muncul.
 *  4. Setelah `page.reload()` di E2E, buka `?verify=<id>` — SELECT
 *     ulang tanpa cache in-memory, id harus TETAP muncul (bukti hidden
 *     dipersist di server, bukan cuma cache React Query).
 *  5. Aksi `cleanup` menghapus row supaya harness idempotent.
 *
 * Tidak diindeks; jangan tautkan dari UI.
 */
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type PrepareResult = {
  ok: boolean;
  messageId: string | null;
  hiddenAfter: boolean;
  step: string;
  error: string | null;
};

type VerifyResult = {
  ok: boolean;
  messageId: string;
  hidden: boolean;
  error: string | null;
};

async function fetchOneMessageId(): Promise<string | null> {
  // Ambil pesan yang bisa dibaca user (RLS `messages_select_member` sudah
  // membatasi ke pesan di conversation milik user).
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].id as string;
}

async function isHidden(messageId: string): Promise<{ hidden: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from("message_hidden")
    .select("message_id")
    .eq("message_id", messageId)
    .limit(1);
  if (error) return { hidden: false, error: error.message };
  return { hidden: (data ?? []).length > 0, error: null };
}

function Harness() {
  const search = useSearch({ from: "/lovable/visual/message-hidden-persist" });
  const verifyId = (search as { verify?: string }).verify ?? null;

  const [prep, setPrep] = useState<PrepareResult | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [cleanupState, setCleanupState] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function runPrepare() {
    setRunning(true);
    setPrep(null);
    try {
      const id = await fetchOneMessageId();
      if (!id) {
        setPrep({
          ok: false,
          messageId: null,
          hiddenAfter: false,
          step: "fetch-message",
          error: "no-messages-visible-to-user",
        });
        return;
      }
      const rpc = await supabase.rpc("message_hide_for_me", { _msg: id });
      if (rpc.error) {
        setPrep({
          ok: false,
          messageId: id,
          hiddenAfter: false,
          step: "rpc",
          error: rpc.error.message,
        });
        return;
      }
      const chk = await isHidden(id);
      setPrep({
        ok: chk.hidden,
        messageId: id,
        hiddenAfter: chk.hidden,
        step: chk.hidden ? "done" : "select-after-rpc",
        error: chk.error,
      });
    } finally {
      setRunning(false);
    }
  }

  async function runVerify(id: string) {
    setRunning(true);
    setVerify(null);
    const chk = await isHidden(id);
    setVerify({
      ok: chk.hidden && !chk.error,
      messageId: id,
      hidden: chk.hidden,
      error: chk.error,
    });
    setRunning(false);
  }

  async function runCleanup(id: string) {
    setRunning(true);
    setCleanupState(null);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      setCleanupState("no-user");
      setRunning(false);
      return;
    }
    const { error } = await supabase
      .from("message_hidden")
      .delete()
      .eq("message_id", id)
      .eq("user_id", uid);
    setCleanupState(error ? `err:${error.message}` : "ok");
    setRunning(false);
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">
        message_hidden — persist across refresh
      </h1>

      {!verifyId && (
        <section className="space-y-2">
          <Button
            data-testid="run-prepare"
            onClick={runPrepare}
            disabled={running}
          >
            {running ? "Running…" : "1. Prepare (hide a message)"}
          </Button>
          {prep && (
            <dl
              className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm"
              data-testid="prepare-block"
            >
              <dt>ok</dt>
              <dd data-testid="prepare-ok">{String(prep.ok)}</dd>
              <dt>messageId</dt>
              <dd data-testid="prepare-message-id">
                {prep.messageId ?? "-"}
              </dd>
              <dt>hiddenAfter</dt>
              <dd data-testid="prepare-hidden-after">
                {String(prep.hiddenAfter)}
              </dd>
              <dt>step</dt>
              <dd data-testid="prepare-step">{prep.step}</dd>
              <dt>error</dt>
              <dd data-testid="prepare-error">{prep.error ?? "-"}</dd>
            </dl>
          )}
        </section>
      )}

      {verifyId && (
        <section className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Verify mode — id: <code>{verifyId}</code>
          </p>
          <Button
            data-testid="run-verify"
            onClick={() => runVerify(verifyId)}
            disabled={running}
          >
            {running ? "Running…" : "2. Verify still hidden"}
          </Button>
          {verify && (
            <dl
              className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm"
              data-testid="verify-block"
            >
              <dt>ok</dt>
              <dd data-testid="verify-ok">{String(verify.ok)}</dd>
              <dt>hidden</dt>
              <dd data-testid="verify-hidden">{String(verify.hidden)}</dd>
              <dt>error</dt>
              <dd data-testid="verify-error">{verify.error ?? "-"}</dd>
            </dl>
          )}
          <Button
            data-testid="run-cleanup"
            variant="secondary"
            onClick={() => runCleanup(verifyId)}
            disabled={running}
          >
            3. Cleanup
          </Button>
          {cleanupState && (
            <p className="text-xs" data-testid="cleanup-state">
              cleanup: {cleanupState}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

export const Route = createFileRoute("/lovable/visual/message-hidden-persist")({
  validateSearch: (s: Record<string, unknown>) => ({
    verify: typeof s.verify === "string" ? s.verify : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Harness · message_hidden persist" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Harness,
});