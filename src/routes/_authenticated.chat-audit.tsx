import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowLeft, History, Trash2, EyeOff, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { goBackOr } from "@/lib/back-nav";

const searchSchema = z.object({
  c: z.string().uuid().optional(),
});

type AuditRow = {
  id: string;
  conversation_id: string;
  message_id: string | null;
  message_ids: string[] | null;
  actor_user_id: string;
  action: "for_me" | "for_all" | "for_me_bulk" | "for_all_bulk" | "all_mine";
  count: number;
  created_at: string;
};

const ACTION_LABEL: Record<AuditRow["action"], string> = {
  for_me: "Hapus untuk saya",
  for_all: "Hapus untuk semua orang",
  for_me_bulk: "Hapus untuk saya (massal)",
  for_all_bulk: "Hapus untuk semua (massal)",
  all_mine: "Hapus semua pesan saya",
};

function ActionIcon({ action }: { action: AuditRow["action"] }) {
  if (action === "for_me" || action === "for_me_bulk")
    return <EyeOff className="h-4 w-4 text-muted-foreground" />;
  if (action === "all_mine") return <Users className="h-4 w-4 text-destructive" />;
  return <Trash2 className="h-4 w-4 text-destructive" />;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AuditPage() {
  const { c } = Route.useSearch();

  const audit = useQuery({
    queryKey: ["chat-delete-audit", c ?? "all"],
    queryFn: async (): Promise<AuditRow[]> => {
      let q = supabase
        .from("chat_delete_audit")
        .select("id, conversation_id, message_id, message_ids, actor_user_id, action, count, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (c) q = q.eq("conversation_id", c);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const actorIds = Array.from(new Set((audit.data ?? []).map((r) => r.actor_user_id)));
  const profiles = useQuery({
    queryKey: ["chat-audit-profiles", actorIds.sort().join(",")],
    enabled: actorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, invite_code")
        .in("id", actorIds);
      if (error) throw error;
      const map = new Map<string, { name: string }>();
      for (const p of data ?? []) {
        const row = p as { display_name?: string | null; invite_code?: string | null };
        const pin = row.invite_code
          ? `PIN ${row.invite_code.toUpperCase().replace(/(.{4})(.{4})/, "$1-$2")}`
          : null;
        map.set(p.id as string, { name: row.display_name || pin || "Pengguna" });
      }
      return map;
    },
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-ms-4 p-ms-4">
      <div className="flex items-center gap-ms-2">
        <Button asChild variant="ghost" size="icon" aria-label="Kembali">
          {c ? (
            <Link to="/chat/$conversationId" params={{ conversationId: c }}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          ) : (
            <Link to="/chat">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          )}
        </Button>
        <div className="flex flex-1 items-center gap-ms-2">
          <History className="h-5 w-5 text-primary" />
          <h1 className="text-ms-lg font-semibold">Log hapus pesan</h1>
        </div>
        {c ? <Badge variant="secondary">Percakapan ini</Badge> : <Badge variant="outline">Semua percakapan</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-ms-base">Aktivitas terbaru</CardTitle>
        </CardHeader>
        <CardContent>
          {audit.isLoading ? (
            <p className="text-ms-sm text-muted-foreground">Memuat…</p>
          ) : audit.isError ? (
            <p className="text-ms-sm text-destructive">Gagal memuat log.</p>
          ) : (audit.data ?? []).length === 0 ? (
            <p className="text-ms-sm text-muted-foreground">Belum ada aktivitas penghapusan tercatat.</p>
          ) : (
            <ul className="divide-y">
              {(audit.data ?? []).map((row) => {
                const who = profiles.data?.get(row.actor_user_id)?.name ?? "Pengguna";
                return (
                  <li key={row.id} className="flex items-start gap-ms-3 py-ms-2">
                    <div className="mt-0.5"><ActionIcon action={row.action} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ms-sm">
                        <span className="font-medium">{who}</span>
                        <span className="text-muted-foreground">·</span>
                        <span>{ACTION_LABEL[row.action]}</span>
                        {row.count > 1 ? (
                          <Badge variant="outline" className="ml-1">{row.count} pesan</Badge>
                        ) : null}
                      </div>
                      <div className="text-ms-xs text-muted-foreground">{fmt(row.created_at)}</div>
                      {!c ? (
                        <Link
                          to="/chat/$conversationId"
                          params={{ conversationId: row.conversation_id }}
                          className="text-ms-xs text-primary hover:underline"
                        >
                          Buka percakapan
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/chat-audit")({
  validateSearch: searchSchema,
  component: AuditPage,
});