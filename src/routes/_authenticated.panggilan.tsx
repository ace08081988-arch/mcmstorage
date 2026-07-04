import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Phone, PhoneMissed, Video as VideoIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatBottomNav } from "@/components/chat/ChatBottomNav";
import { listMyCalls, formatCallDuration, createCallRow, type CallRow } from "@/lib/calls";
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
      { title: "Panggilan · MCM" },
      { name: "description", content: "Riwayat panggilan suara & video MCM Chat." },
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
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col wa-surface">
      <header className="wa-header sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-3">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label="Kembali">
          <Link to="/chat"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <h1 className="text-lg font-semibold">Panggilan</h1>
      </header>

      <div className="flex-1">
        {calls.isLoading ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">Memuat riwayat…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8">
            <div className="mx-auto max-w-sm space-y-3 rounded-2xl border bg-card p-6 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
                <PhoneMissed className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold">Belum ada panggilan</h2>
              <p className="text-xs text-muted-foreground">
                Riwayat panggilan suara & video akan muncul di sini. Mulai panggilan
                dari dalam percakapan.
              </p>
              <Button asChild size="sm" className="gap-1.5">
                <Link to="/chat"><Phone className="h-4 w-4" /> Buka daftar chat</Link>
              </Button>
            </div>
          </div>
        ) : (
          <ul className="divide-y">
            {rows.map((c) => (
              <CallRowItem
                key={c.id}
                row={c}
                myId={myId ?? null}
                nameMap={profiles.data ?? {}}
                isCalling={callingId === c.id}
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
    </main>
  );
}

function CallRowItem({
  row, myId, nameMap, isCalling, onStartCall,
}: {
  row: CallRow;
  myId: string | null;
  nameMap: Record<string, string>;
  isCalling: boolean;
  onStartCall: (row: CallRow) => void | Promise<void>;
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
    <li className="flex items-center gap-1 px-2 py-1">
      <Link
        to="/chat/$conversationId"
        params={{ conversationId: row.conversation_id }}
        preload="intent"
        className="flex flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60 active:bg-muted"
        aria-label={`Buka chat dengan ${peerName}`}
      >
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold uppercase">
          {peerName.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm font-medium ${missed ? "text-red-600" : ""}`}>{peerName}</div>
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
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors ${
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
    </li>
  );
}