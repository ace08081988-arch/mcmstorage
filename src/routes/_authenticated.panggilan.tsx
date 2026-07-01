import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Phone, PhoneMissed, PhoneIncoming, PhoneOutgoing, Video as VideoIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatBottomNav } from "@/components/chat/ChatBottomNav";
import { listMyCalls, formatCallDuration, type CallRow } from "@/lib/calls";
import { supabase } from "@/integrations/supabase/client";
import { useMyUserId } from "@/lib/chat";
import { formatInviteCode } from "@/lib/invite";

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
  row, myId, nameMap,
}: {
  row: CallRow;
  myId: string | null;
  nameMap: Record<string, string>;
}) {
  const outgoing = row.caller_id === myId;
  const peerId = outgoing ? row.callee_id : row.caller_id;
  const peerName = (peerId && nameMap[peerId]) || "Kontak";
  const missed = row.status === "missed" || (row.status === "declined" && !outgoing);
  const Icon = row.kind === "video" ? VideoIcon : Phone;
  const DirIcon = missed
    ? PhoneMissed
    : outgoing
    ? PhoneOutgoing
    : PhoneIncoming;
  const dirClass = missed ? "text-red-600" : outgoing ? "text-emerald-600" : "text-primary";
  const statusLabel =
    row.status === "ended"
      ? formatCallDuration(row.duration_sec)
      : row.status === "missed"
      ? "Tidak dijawab"
      : row.status === "declined"
      ? outgoing ? "Ditolak" : "Ditolak"
      : row.status === "cancelled"
      ? "Dibatalkan"
      : row.status === "failed"
      ? "Gagal"
      : row.status === "ringing"
      ? "Berdering…"
      : "Diterima";

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="grid h-11 w-11 place-items-center rounded-full bg-muted text-sm font-semibold uppercase">
        {peerName.charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-medium ${missed ? "text-red-600" : ""}`}>{peerName}</div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <DirIcon className={`h-3 w-3 ${dirClass}`} />
          <span>{statusLabel}</span>
          <span>·</span>
          <span>{timeLabel(row.started_at)}</span>
        </div>
      </div>
      <Icon className={`h-5 w-5 ${row.kind === "video" ? "text-primary" : "text-muted-foreground"}`} />
    </li>
  );
}