import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowLeft, Check, X, Clock, UserPlus, Loader2 } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/kontak/permintaan")({
  component: FriendRequestsPage,
});

function FriendRequestsPage() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useFriendRequests("all", true);
  const { incoming, outgoing } = useMemo(() => splitByDirection(data), [data]);
  const respond = useRespondFriendRequest();
  const cancel = useCancelFriendRequest();

  async function accept(id: string, name: string | null) {
    try {
      await respond.mutateAsync({ requestId: id, accept: true });
      toast.success(`Permintaan dari ${name ?? "kontak"} diterima. Sekarang bisa chat & panggil.`);
    } catch (e) {
      toast.error((e as Error).message || "Gagal menerima permintaan.");
    }
  }
  async function reject(id: string, name: string | null) {
    try {
      await respond.mutateAsync({ requestId: id, accept: false });
      toast.success(`Permintaan dari ${name ?? "kontak"} ditolak.`);
    } catch (e) {
      toast.error((e as Error).message || "Gagal menolak permintaan.");
    }
  }
  async function doCancel(id: string, name: string | null) {
    try {
      await cancel.mutateAsync(id);
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
            ) : incoming.length === 0 ? (
              <EmptyState
                title="Belum ada permintaan masuk"
                subtitle="Bagikan PIN kamu di menu Undang supaya teman bisa mengirim permintaan."
              />
            ) : (
              incoming.map((r) => (
                <RequestCard
                  key={r.id}
                  name={r.peer_display_name}
                  pin={r.peer_invite_code}
                  avatarUrl={r.peer_avatar_url}
                  createdAt={r.created_at}
                  actions={
                    <>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => accept(r.id, r.peer_display_name)}
                        disabled={respond.isPending}
                        className="gap-1"
                      >
                        <Check className="h-4 w-4" /> Terima
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
                  }
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="outgoing" className="mt-3 space-y-2">
            {isLoading ? (
              <SkeletonList />
            ) : isError ? (
              <ErrorRetry onRetry={() => refetch()} />
            ) : outgoing.length === 0 ? (
              <EmptyState
                title="Belum ada permintaan terkirim"
                subtitle="Masukkan PIN teman di menu Undang untuk mengirim permintaan pertemanan."
              />
            ) : (
              outgoing.map((r) => (
                <RequestCard
                  key={r.id}
                  name={r.peer_display_name}
                  pin={r.peer_invite_code}
                  avatarUrl={r.peer_avatar_url}
                  createdAt={r.created_at}
                  statusHint={
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">
                      <Clock className="h-3 w-3" /> Menunggu diterima
                    </span>
                  }
                  actions={
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
                  }
                />
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