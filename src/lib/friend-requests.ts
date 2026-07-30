import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelFriendRequest,
  listFriendRequests,
  respondFriendRequest,
  type FriendRequestRow,
} from "@/lib/invite";

/**
 * React Query wrappers for the friend request RPCs. Cache is keyed by
 * direction + onlyPending so the sidebar badge, the /kontak/permintaan tabs,
 * and the chat banner share the same data and update in lock-step whenever
 * a request is sent, accepted, rejected, or cancelled.
 */

export function friendRequestsKey(direction: "incoming" | "outgoing" | "all", onlyPending: boolean) {
  return ["friend-requests", direction, onlyPending] as const;
}

export function useFriendRequests(
  direction: "incoming" | "outgoing" | "all" = "all",
  onlyPending = true,
) {
  return useQuery({
    queryKey: friendRequestsKey(direction, onlyPending),
    queryFn: () => listFriendRequests(direction, onlyPending),
    // Refresh every ~30s so accepted/pending states stay recent without
    // spamming the server. Real-time subscription is added by the page
    // component when it wants instant updates.
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function usePendingIncomingCount(): number {
  const { data } = useFriendRequests("incoming", true);
  return data?.filter((r) => r.status === "pending").length ?? 0;
}

export function useRespondFriendRequest() {
  const qc = useQueryClient();
  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["friend-requests"] });
    qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
  }, [qc]);
  return useMutation({
    mutationFn: (args: { requestId: string; accept: boolean }) =>
      respondFriendRequest(args.requestId, args.accept),
    onSuccess: invalidateAll,
  });
}

export function useCancelFriendRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => cancelFriendRequest(requestId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["friend-requests"] }),
  });
}

export function splitByDirection(rows: FriendRequestRow[] | undefined) {
  const incoming: FriendRequestRow[] = [];
  const outgoing: FriendRequestRow[] = [];
  for (const r of rows ?? []) {
    if (r.direction === "incoming") incoming.push(r);
    else outgoing.push(r);
  }
  return { incoming, outgoing };
}