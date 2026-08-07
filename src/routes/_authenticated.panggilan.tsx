import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Phone, PhoneMissed, Video as VideoIcon, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatBottomNav } from "@/components/chat/ChatBottomNav";
import {
  listMyCalls,
  formatCallDuration,
  createCallRow,
  hideCalls,
  hideAllCalls,
  type CallRow,
} from "@/lib/calls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { dispatchStartCall } from "@/components/chat/CallHost";
import { ringUser } from "@/lib/webrtc";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMyUserId } from "@/lib/chat";
import { formatInviteCode } from "@/lib/invite";
import type { CallVisualStatus } from "@/lib/call-status-visual";
import { CallStatusButton } from "@/components/chat/CallStatusButton";

export const Route = createFileRoute("/_authenticated/panggilan")({
  component: PanggilanPage,
  head: () => ({
    meta: [
      { title: "Panggilan — Ace Storage" },
      { name: "description", content: "Riwayat panggilan suara & video Ace Chat." },
    ],
  }),
});

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

function PanggilanPage() {
  const { data: myId } = useMyUserId();
  const [callingId, setCallingId] = useState<string | null>(null);
  const qc = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<CallRow | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const calls = useQuery({
    queryKey: ["chat-calls", myId ?? "_"],
    queryFn: () => listMyCalls(100),
    enabled: !!myId,
    refetchOnWindowFocus: false,
  });

  // Ambil nama peer per user.
  const peerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of calls.data ?? []) {
      if (c.caller_id !== myId) ids.add(c.caller_id);
      if (c.callee_id && c.callee_id !== myId) ids.add(c.callee_id);
    }
    return Array.from(ids);
  }, [calls.data, myId]);

  const profiles = useQuery({
    queryKey: ["chat-calls-profiles", peerIds.join(",")],
    queryFn: async () => {
      if (peerIds.length === 0) return {} as Record<string, string>;
      // Ambil alias kontak (nama yang diedit user di chat / address book) —
      // ini prioritas utama, jatuh ke profil publik hanya bila alias kosong.
      const [aliasRes, profRes] = await Promise.all([
        supabase
          .from("address_book")
          .select("linked_user_id,name,updated_at")
          .in("linked_user_id", peerIds)
          .order("updated_at", { ascending: false }),
        supabase
          .from("profiles")
          .select("id, display_name, invite_code")
          .in("id", peerIds),
      ]);
      const aliasMap: Record<string, string> = {};
      for (const a of (aliasRes.data ?? []) as {
        linked_user_id: string | null;
        name: string | null;
      }[]) {
        const key = a.linked_user_id;
        const name = a.name?.trim();
        if (!key || !name) continue;
        // Order desc → simpan hanya yang pertama (terbaru) untuk tiap peer.
        if (!aliasMap[key]) aliasMap[key] = name;
      }
      const map: Record<string, string> = {};
      const pinFallback = (id: string, invite?: string | null): string => {
        // Prioritas fallback: PIN (invite_code) → cuplikan ID → "Kontak".
        // JANGAN tampilkan nomor telepon mentah — sesuai kebijakan branding
        // PIN xxxx-xxxx (lihat tests/e2e/pin-branding-*.spec.ts).
        const clean = (invite ?? "").trim();
        if (clean) return `PIN ${formatInviteCode(clean)}`;
        const short = id.replace(/-/g, "").slice(0, 8).toUpperCase();
        return short ? `PIN ${formatInviteCode(short)}` : "Kontak";
      };
      for (const p of (profRes.data ?? []) as {
        id: string;
        display_name: string | null;
        invite_code: string | null;
      }[]) {
        const alias = aliasMap[p.id];
        map[p.id] =
          alias ||
          p.display_name?.trim() ||
          pinFallback(p.id, p.invite_code);
      }
      // Peer tanpa row profil: pakai alias bila ada, jika tidak fallback
      // ke cuplikan ID (masih dibungkus format PIN agar konsisten UI).
      for (const id of peerIds) {
        if (map[id]) continue;
        map[id] = aliasMap[id] || pinFallback(id, null);
      }
      return map;
    },
    enabled: peerIds.length > 0,
  });

  const rows = calls.data ?? [];
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col wa-surface [--chat-nav-h:calc(var(--ms-tap)+1.25rem+env(safe-area-inset-bottom,0px))]">
      <header
        className="wa-header sticky top-0 z-10 flex items-center gap-ms-2 border-b px-ms-3 py-ms-3"
        style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}
      >
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full touch-manipulation"
          aria-label="Kembali"
        >
          <Link to="/chat"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <h1 className="text-ms-lg font-semibold">Panggilan</h1>
        {(calls.data ?? []).length > 0 ? (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-11 w-11 rounded-full touch-manipulation"
            aria-label="Hapus semua riwayat panggilan"
            onClick={() => setConfirmClearAll(true)}
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        ) : null}
      </header>

      <div className="flex-1 pb-[var(--chat-nav-h)]">
        {calls.isLoading ? (
          <div className="px-ms-4 py-ms-6 text-center text-ms-xs text-muted-foreground">Memuat riwayat…</div>
        ) : rows.length === 0 ? (
          <div className="px-ms-4 py-8">
            <div className="mx-auto max-w-sm space-ms-3 rounded-2xl border bg-card p-ms-6 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
                <PhoneMissed className="h-6 w-6" />
              </div>
              <h2 className="text-ms-base font-semibold">Belum ada panggilan</h2>
              <p className="text-ms-xs text-muted-foreground">
                Riwayat panggilan suara & video akan muncul di sini. Mulai panggilan
                dari dalam percakapan.
              </p>
              <Button asChild size="sm" className="gap-ms-1.5">
                <Link to="/chat"><Phone className="h-4 w-4" /> Buka daftar chat</Link>
              </Button>
            </div>
          </div>
        ) : (
          <ul className="divide-y pb-2">
            {rows.map((c) => (
              <CallRowItem
                key={c.id}
                row={c}
                myId={myId ?? null}
                nameMap={profiles.data ?? {}}
                isCalling={callingId === c.id}
                onDelete={(r) => setPendingDelete(r)}
                onStartCall={async (r) => {
                  if (!myId) return;
                  const peerId = r.caller_id === myId ? r.callee_id : r.caller_id;
                  if (!peerId) return;
                  const peerName = (profiles.data ?? {})[peerId] || "Kontak";
                  setCallingId(r.id);
                  try {
                    const row = await createCallRow({
                      conversationId: r.conversation_id,
                      callerId: myId,
                      calleeId: peerId,
                      kind: r.kind,
                    });
                    dispatchStartCall({ callId: row.id, kind: r.kind, peerName });
                    void ringUser({
                      calleeId: peerId,
                      callId: row.id,
                      callerId: myId,
                      kind: r.kind,
                      conversationId: r.conversation_id,
                      callerName: peerName,
                    }).catch(() => { /* ring gagal — UI tetap jalan */ });
                  } catch (e) {
                    const { describeCallError } = await import("@/lib/call-errors");
                    const info = describeCallError(e, r.kind === "video" ? "video" : "audio");
                    toast.error(info.title, { description: info.hint, duration: 8000 });
                  } finally {
                    setCallingId(null);
                  }
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <ChatBottomNav />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus riwayat panggilan?</AlertDialogTitle>
            <AlertDialogDescription>
              Entri ini hanya dihapus dari daftar Anda. Lawan bicara tetap
              melihat riwayat panggilannya.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                const row = pendingDelete;
                if (!row) return;
                setBusy(true);
                try {
                  await hideCalls([row.id]);
                  await qc.invalidateQueries({ queryKey: ["chat-calls"] });
                  toast.success("Riwayat panggilan dihapus");
                  setPendingDelete(null);
                } catch {
                  toast.error("Gagal menghapus riwayat");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus semua riwayat panggilan?</AlertDialogTitle>
            <AlertDialogDescription>
              Seluruh daftar panggilan Anda akan dikosongkan. Tindakan ini tidak
              memengaruhi riwayat milik lawan bicara.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await hideAllCalls();
                  await qc.invalidateQueries({ queryKey: ["chat-calls"] });
                  toast.success("Riwayat panggilan dikosongkan");
                  setConfirmClearAll(false);
                } catch {
                  toast.error("Gagal mengosongkan riwayat");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Hapus semua
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function CallRowItem({
  row, myId, nameMap, isCalling, onStartCall, onDelete,
}: {
  row: CallRow;
  myId: string | null;
  nameMap: Record<string, string>;
  isCalling: boolean;
  onStartCall: (row: CallRow) => void | Promise<void>;
  onDelete: (row: CallRow) => void;
}) {
  const outgoing = row.caller_id === myId;
  const peerId = outgoing ? row.callee_id : row.caller_id;
  const peerName = (peerId && nameMap[peerId]) || "Kontak";
  const Icon = row.kind === "video" ? VideoIcon : Phone;
  const missed = row.status === "missed" || (row.status === "declined" && !outgoing);
  // Untuk status "ended", tampilkan durasi alih-alih label "Diterima".
  const overrideLabel =
    row.status === "ended" ? formatCallDuration(row.duration_sec) : undefined;

  return (
    <li className="flex items-center gap-ms-1 px-ms-2 py-1">
      <Link
        to="/chat/$conversationId"
        params={{ conversationId: row.conversation_id }}
        preload="intent"
        className="flex min-h-[56px] flex-1 items-center gap-ms-3 rounded-lg px-ms-2 py-ms-2 text-left transition-colors touch-manipulation hover:bg-muted/60 active:bg-muted"
        aria-label={`Buka chat dengan ${peerName}`}
      >
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-ms-sm font-semibold uppercase">
          {peerName.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`truncate text-ms-sm font-medium ${missed ? "text-red-600" : ""}`}>{peerName}</div>
          <CallStatusButton
            status={row.status as CallVisualStatus}
            outgoing={outgoing}
            overrideLabel={overrideLabel}
            trailing={
              <>
                <span>·</span>
                <span>{timeLabel(row.started_at)}</span>
              </>
            }
          />
        </div>
      </Link>
      <button
        type="button"
        disabled={isCalling}
        aria-busy={isCalling}
        onClick={() => void onStartCall(row)}
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors touch-manipulation ${
          isCalling
            ? "cursor-not-allowed opacity-60"
            : "hover:bg-muted/60 active:bg-muted"
        }`}
        aria-label={
          isCalling
            ? `Memulai panggilan ${row.kind === "video" ? "video" : "suara"} ke ${peerName}`
            : row.kind === "video"
              ? `Panggilan video ke ${peerName}`
              : `Panggilan suara ke ${peerName}`
        }
      >
        {isCalling ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <Icon className={`h-5 w-5 ${row.kind === "video" ? "text-primary" : "text-muted-foreground"}`} />
        )}
      </button>
      <button
        type="button"
        onClick={() => onDelete(row)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors touch-manipulation hover:bg-destructive/10 hover:text-destructive active:bg-destructive/20"
        aria-label={`Hapus riwayat panggilan dengan ${peerName}`}
      >
        <Trash2 className="h-[18px] w-[18px]" />
      </button>
    </li>
  );
}