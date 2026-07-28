import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { notifyLocal, setAppBadge } from "@/lib/local-notify";

type ConvLite = { id: string; display_title: string; muted_until?: string | null; unread?: number };

/**
 * Host notifikasi in-app global.
 *
 * Mengubah pesan chat masuk (realtime) menjadi notifikasi sistem asli —
 * sebelumnya pesan baru hanya menaikkan badge di dalam aplikasi, jadi tidak
 * terasa seperti aplikasi chat sungguhan saat layar mati / aplikasi di
 * background. Notifikasi ditekan → langsung buka percakapannya.
 *
 * Aturan diam:
 *  - pesan dari diri sendiri
 *  - percakapan yang sedang dibuka DAN aplikasi sedang terlihat
 *  - percakapan yang di-mute
 *  - preferensi/DND (ditangani `notifyLocal`)
 */
export function LiveNotificationHost() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let meId: string | null = null;

    void import("@/lib/local-notify").then(({ initLocalNotifications }) =>
      initLocalNotifications({
        onOpenUrl: (url) => {
          try {
            router.navigate({ to: url.startsWith("/") ? url : `/${url}` });
          } catch {
            window.location.assign(url);
          }
        },
      }),
    ).catch(() => {});

    void (async () => {
      try {
        const { getCurrentUser } = await import("@/lib/current-user");
        const u = await getCurrentUser();
        meId = u?.id ?? null;
        if (!meId || cancelled) return;

        channel = supabase
          .channel(`notif-inbox:${meId}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages" },
            (payload) => {
              const row = payload.new as {
                id: string;
                conversation_id: string;
                sender_id: string | null;
                body: string | null;
                kind?: string | null;
              };
              if (!row || row.sender_id === meId) return;

              const convs =
                (qc.getQueryData(["chat", "conversations"]) as ConvLite[] | undefined) ?? [];
              const conv = convs.find((c) => c.id === row.conversation_id);
              // RLS sudah memfilter, tapi kalau percakapan belum ada di cache
              // (mis. chat baru) tetap tampilkan dengan judul generik.
              const title = conv?.display_title || "Pesan baru";

              if (conv?.muted_until && new Date(conv.muted_until).getTime() > Date.now()) return;

              const viewing = pathRef.current === `/chat/${row.conversation_id}`;
              const visible = typeof document !== "undefined" && document.visibilityState === "visible";
              if (viewing && visible) return;

              const body =
                (row.body ?? "").trim() ||
                (row.kind === "image" ? "📷 Foto" : row.kind === "file" ? "📎 Lampiran" : "Pesan baru");

              void notifyLocal({
                kind: "chat",
                title,
                body: body.slice(0, 180),
                url: `/chat/${row.conversation_id}`,
                tag: `chat:${row.conversation_id}`,
                group: "chat",
              });
            },
          )
          .subscribe();
      } catch (e) {
        console.warn("[live-notif] gagal berlangganan", e);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) { try { void supabase.removeChannel(channel); } catch { /* ignore */ } }
    };
  }, [qc, router]);

  // Badge ikon aplikasi mengikuti total pesan belum dibaca.
  const convs = qc.getQueryData(["chat", "conversations"]) as ConvLite[] | undefined;
  useEffect(() => {
    const total = (convs ?? []).reduce((acc, c) => acc + (c.unread ?? 0), 0);
    void setAppBadge(total);
  }, [convs]);

  return null;
}
