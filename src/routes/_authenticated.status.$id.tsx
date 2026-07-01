import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Heart,
  MessageCircle,
  Download,
  Trash2,
  Send,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  addComment,
  deleteComment,
  deleteStatus,
  downloadStatus,
  getStatus,
  hasLiked,
  listComments,
  statusSignedUrl,
  toggleLike,
  type StatusCommentRow,
  type StatusRow,
} from "@/lib/status";

export const Route = createFileRoute("/_authenticated/status/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Status · MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: StatusDetailPage,
});

function StatusDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusRow | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [comments, setComments] = useState<StatusCommentRow[]>([]);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [uid, setUid] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!alive) return;
      setUid(u.user?.id ?? null);
      const s = await getStatus(id);
      if (!alive) return;
      setStatus(s);
      if (s && s.media_type !== "text") {
        setMediaUrl(await statusSignedUrl(s.media_path));
      }
      const [cs, l, lc] = await Promise.all([
        listComments(id),
        hasLiked(id),
        supabase.from("status_likes").select("status_id", { count: "exact", head: true }).eq("status_id", id),
      ]);
      if (!alive) return;
      setComments(cs);
      setLiked(l);
      setLikeCount(lc.count ?? 0);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const isOwner = useMemo(
    () => !!(uid && status && uid === status.user_id),
    [uid, status],
  );

  const onLike = async () => {
    const newLiked = await toggleLike(id);
    setLiked(newLiked);
    setLikeCount((n) => Math.max(0, n + (newLiked ? 1 : -1)));
  };

  const onSend = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const c = await addComment(id, text);
    setBusy(false);
    if (!c) {
      toast.error("Gagal mengirim komentar");
      return;
    }
    setComments((prev) => [...prev, c]);
    setText("");
  };

  const onDownload = async () => {
    if (!status || status.media_type === "text") {
      toast.info("Status teks tidak dapat diunduh");
      return;
    }
    const ok = await downloadStatus(status.media_path);
    if (ok) toast.success("Berhasil diunduh");
    else toast.error("Gagal mengunduh");
  };

  const onDelete = async () => {
    if (!status || !isOwner) return;
    if (!confirm("Hapus status ini?")) return;
    const ok = await deleteStatus(status.id, status.media_path);
    if (ok) {
      toast.success("Status dihapus");
      navigate({ to: "/pembaruan" });
    } else {
      toast.error("Gagal menghapus");
    }
  };

  const onDeleteComment = async (cid: string) => {
    const ok = await deleteComment(cid);
    if (ok) setComments((prev) => prev.filter((c) => c.id !== cid));
  };

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!status) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Status tidak ditemukan atau sudah kedaluwarsa.
        </p>
        <Button onClick={() => navigate({ to: "/pembaruan" })} variant="outline">
          Kembali
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-2 py-2 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Kembali"
          onClick={() => navigate({ to: "/pembaruan" })}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="mr-auto text-sm text-muted-foreground">
          {new Date(status.created_at).toLocaleString("id-ID")}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Unduh status"
          onClick={onDownload}
          disabled={status.media_type === "text"}
        >
          <Download className="size-5" />
        </Button>
        {isOwner && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Hapus status"
            onClick={onDelete}
          >
            <Trash2 className="size-5 text-destructive" />
          </Button>
        )}
      </header>

      <div className="relative flex items-center justify-center bg-black">
        {status.media_type === "image" && mediaUrl && (
          <img src={mediaUrl} alt={status.caption ?? "Status"} className="max-h-[70dvh] w-full object-contain" />
        )}
        {status.media_type === "video" && mediaUrl && (
          <video src={mediaUrl} controls autoPlay playsInline className="max-h-[70dvh] w-full" />
        )}
        {status.media_type === "text" && (
          <div
            className="flex min-h-[50dvh] w-full items-center justify-center p-6 text-center text-2xl font-semibold text-white"
            style={{ background: status.bg_color || "#0f172a" }}
          >
            {status.caption}
          </div>
        )}
      </div>

      {status.caption && status.media_type !== "text" && (
        <p className="border-b px-4 py-3 text-sm">{status.caption}</p>
      )}

      <div className="flex items-center gap-4 px-4 py-3">
        <button
          onClick={onLike}
          className="flex items-center gap-1.5 text-sm"
          aria-pressed={liked}
          aria-label={liked ? "Batalkan suka" : "Suka status"}
        >
          <Heart
            className={`size-6 ${liked ? "fill-red-500 text-red-500" : "text-foreground"}`}
          />
          <span className="tabular-nums">{likeCount}</span>
        </button>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MessageCircle className="size-5" />
          <span className="tabular-nums">{comments.length}</span>
        </div>
      </div>

      <section aria-label="Komentar" className="flex-1 space-y-2 border-t px-4 py-3">
        {comments.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Belum ada komentar. Jadilah yang pertama.
          </p>
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleString("id-ID")}
                  </div>
                  <div className="text-sm">{c.body}</div>
                </div>
                {(c.user_id === uid || isOwner) && (
                  <button
                    aria-label="Hapus komentar"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => onDeleteComment(c.id)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        className="sticky bottom-0 flex items-center gap-2 border-t bg-background/95 p-3 backdrop-blur"
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tulis komentar…"
          maxLength={2000}
        />
        <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Kirim komentar">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </form>
    </div>
  );
}