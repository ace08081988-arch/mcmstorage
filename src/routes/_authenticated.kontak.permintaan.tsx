import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, X, Clock, UserPlus, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatInviteCode } from "@/lib/invite";
import {
  splitByDirection,
  useCancelFriendRequest,
  useFriendRequests,
  useRespondFriendRequest,
} from "@/lib/friend-requests";
import { useStartDm } from "@/lib/chat";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/kontak/permintaan")({
  component: FriendRequestsPage,
});

function FriendRequestsPage() {
  const router = useRouter();
  const navigate = useNavigate();
  const startDm = useStartDm();
  const qc = useQueryClient();
  const [openingChatId, setOpeningChatId] = useState<string | null>(null);
  // Tampilkan juga baris yang baru saja "accepted"/"rejected" (bukan hanya
  // pending) supaya perubahan status terlihat real-time di kartu sebelum
  // baris menghilang. Filter tampilan tetap membatasi ke pending + status
  // sesaat lewat `recentStatus` di bawah.
  const { data, isLoading, isError, refetch } = useFriendRequests("all", false);
  const [recentStatus, setRecentStatus] = useState<Record<string, "accepted" | "rejected">>({});
  useEffect(() => {
    // Realtime: setiap perubahan pada friend_requests yg menyangkut user
    // saat ini akan invalidate cache → daftar & status ikut update.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`friend-requests:${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "friend_requests", filter: `to_user=eq.${uid}` },
          () => qc.invalidateQueries({ queryKey: ["friend-requests"] }),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "friend_requests", filter: `from_user=eq.${uid}` },
          () => qc.invalidateQueries({ queryKey: ["friend-requests"] }),
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);
  const { incoming, outgoing } = useMemo(() => splitByDirection(data), [data]);
  // Baris yg ditampilkan: semua pending + baris yg baru saja user-action di
  // sesi ini (accepted/rejected/cancelled) supaya perubahan status terlihat
  // dulu sebelum menghilang. Baris terminal lama dari server tidak dimunculkan.
  const incomingVisible = useMemo(
    () => incoming.filter((r) => r.status === "pending" || recentStatus[r.id]),
    [incoming, recentStatus],
  );
  const outgoingVisible = useMemo(
    () => outgoing.filter((r) => r.status === "pending" || recentStatus[r.id]),
    [outgoing, recentStatus],
  );
  const respond = useRespondFriendRequest();
  const cancel = useCancelFriendRequest();

  // Setelah permintaan diterima, spec MCM: langsung buka halaman chat dengan
  // kontak baru. Kita ambil peer_id dari request row, buka/create DM via RPC
  // `start_dm`, lalu navigate. Kalau start_dm gagal (mis. jaringan), tetap
  // tampil toast sukses karena permintaan sudah tercatat accepted di DB.
  async function accept(id: string, peerId: string, name: string | null) {
    try {
      await respond.mutateAsync({ requestId: id, accept: true });
      // Optimistic: langsung tandai "accepted" agar kartu memperlihatkan
      // perubahan status sebelum server refetch selesai / realtime tiba.
      setRecentStatus((s) => ({ ...s, [id]: "accepted" }));
      setOpeningChatId(id);
      try {
        const cid = await startDm.mutateAsync(peerId);
        if (cid) {
          toast.success(`Permintaan diterima. Chat dengan ${name ?? "kontak"} dibuka.`);
          navigate({ to: "/chat/$conversationId", params: { conversationId: cid } });
          return;
        }
        toast.success(`Permintaan dari ${name ?? "kontak"} diterima.`);
      } catch (dmErr) {
        console.error("[friend-accept] start_dm gagal", dmErr);
        toast.error("Kontak diterima, tapi gagal membuka chat. Coba dari daftar chat.");
      } finally {
        setOpeningChatId(null);
      }
    } catch (e) {
      toast.error((e as Error).message || "Gagal menerima permintaan.");
    }
  }
  async function reject(id: string, name: string | null) {
    try {
      await respond.mutateAsync({ requestId: id, accept: false });
      setRecentStatus((s) => ({ ...s, [id]: "rejected" }));
      toast.success(`Permintaan dari ${name ?? "kontak"} ditolak.`);
    } catch (e) {
      toast.error((e as Error).message || "Gagal menolak permintaan.");
    }
  }
  async function doCancel(id: string, name: string | null) {
    try {
      await cancel.mutateAsync(id);
      setRecentStatus((s) => ({ ...s, [id]: "rejected" }));
      toast.success(`Permintaan ke ${name ?? "kontak"} dibatalkan.`);
    } catch (e) {
      toast.error((e as Error).message || "Gagal membatalkan permintaan.");
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-background pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background px-4 py-3">
        <button
          type="button"
          aria-label="Kembali"
          onClick={() => router.history.back()}
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Permintaan pertemanan</h1>
          <p className="text-xs text-muted-foreground">
            Terima permintaan lebih dulu supaya chat, panggilan suara, dan video call bisa dilakukan.
          </p>
        </div>
      </header>

      <section className="px-4 pt-4">
        <Tabs defaultValue="incoming">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="incoming">
              Masuk {incoming.length ? `(${incoming.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="outgoing">
              Terkirim {outgoing.length ? `(${outgoing.length})` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="incoming" className="mt-3 space-y-2">
            {isLoading ? (
              <SkeletonList />
            ) : isError ? (
              <ErrorRetry onRetry={() => refetch()} />
            ) : incomingVisible.length === 0 ? (
              <EmptyState
                title="Belum ada permintaan masuk"
                subtitle="Bagikan PIN kamu di menu Undang supaya teman bisa mengirim permintaan."
              />
            ) : (
              incomingVisible.map((r) => {
                const effective: "pending" | "accepted" | "rejected" =
                  recentStatus[r.id] ??
                  (r.status === "accepted" ? "accepted" : r.status === "rejected" ? "rejected" : "pending");
                return (
                <RequestCard
                  key={r.id}
                  name={r.peer_display_name}
                  pin={r.peer_invite_code}
                  avatarUrl={r.peer_avatar_url}
                  createdAt={r.created_at}
                  statusHint={<StatusChip status={effective} />}
                  actions={
                    effective !== "pending" ? null : (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => accept(r.id, r.peer_id, r.peer_display_name)}
                        disabled={respond.isPending || openingChatId === r.id}
                        className="gap-1"
                      >
                        {openingChatId === r.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}{" "}
                        {openingChatId === r.id ? "Membuka…" : "Terima"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => reject(r.id, r.peer_display_name)}
                        disabled={respond.isPending}
                        className="gap-1"
                      >
                        <X className="h-4 w-4" /> Tolak
                      </Button>
                    </>
                    )
                  }
                />
                );
              })
            )}
          </TabsContent>

          <TabsContent value="outgoing" className="mt-3 space-y-2">
            {isLoading ? (
              <SkeletonList />
            ) : isError ? (
              <ErrorRetry onRetry={() => refetch()} />
            ) : outgoingVisible.length === 0 ? (
              <EmptyState
                title="Belum ada permintaan terkirim"
                subtitle="Masukkan PIN teman di menu Undang untuk mengirim permintaan pertemanan."
              />
            ) : (
              outgoingVisible.map((r) => (
                <React.Fragment key={r.id}>
                <RequestCard
                  name={r.peer_display_name}
                  pin={r.peer_invite_code}
                  avatarUrl={r.peer_avatar_url}
                  createdAt={r.created_at}
                  statusHint={
                    <StatusChip
                      status={
                        recentStatus[r.id] === "rejected"
                          ? "cancelled"
                          : r.status === "accepted"
                            ? "accepted"
                            : r.status === "rejected"
                              ? "rejected"
                              : "pending"
                      }
                    />
                  }
                  actions={
                    r.status !== "pending" ? null : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => doCancel(r.id, r.peer_display_name)}
                      disabled={cancel.isPending}
                      className="gap-1"
                    >
                      <X className="h-4 w-4" /> Batalkan
                    </Button>
                    )
                  }
                />
                </React.Fragment>
              ))
            )}
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}

function RequestCard(props: {
  name: string | null;
  pin: string | null;
  avatarUrl: string | null;
  createdAt: string;
  actions: React.ReactNode;
  statusHint?: React.ReactNode;
}) {
  const initial = (props.name || "?").trim()[0]?.toUpperCase() || "?";
  const when = new Date(props.createdAt);
  const whenLabel = Number.isNaN(when.getTime())
    ? ""
    : when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
      {props.avatarUrl ? (
        <img
          src={props.avatarUrl}
          alt=""
          className="h-11 w-11 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-orange-950 text-lg font-medium text-orange-300">
          {initial}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{props.name ?? "Tanpa nama"}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {props.pin ? <span className="font-mono">PIN {formatInviteCode(props.pin)}</span> : null}
          {whenLabel ? <span>· {whenLabel}</span> : null}
          {props.statusHint}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{props.actions}</div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
    </div>
  );
}

function ErrorRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <div className="font-medium text-destructive">Gagal memuat permintaan.</div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-2">
        Coba lagi
      </Button>
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed p-8 text-center">
      <UserPlus className="mb-2 h-6 w-6 text-muted-foreground" />
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}