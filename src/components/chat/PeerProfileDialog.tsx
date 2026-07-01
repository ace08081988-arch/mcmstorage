import { useQuery } from "@tanstack/react-query";
import { Pencil, BookUser, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAvatarSignedUrl } from "@/lib/profile";
import { formatInviteCode } from "@/lib/invite";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  peerUserId: string | null;
  displayName: string;
  onEditName?: () => void;
  onOpenAddressBook?: () => void;
};

type PeerProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  invite_code: string | null;
};

function initialOf(name: string): string {
  const s = name.trim();
  return s ? s[0]!.toUpperCase() : "?";
}

export function PeerProfileDialog({
  open,
  onOpenChange,
  peerUserId,
  displayName,
  onEditName,
  onOpenAddressBook,
}: Props) {
  const profile = useQuery<PeerProfileRow | null>({
    queryKey: ["peer-profile", peerUserId],
    enabled: open && !!peerUserId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!peerUserId) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, invite_code, phone")
        .eq("id", peerUserId)
        .maybeSingle();
      if (error) throw error;
      return data as PeerProfileRow | null;
    },
  });

  const { data: avatarUrl } = useAvatarSignedUrl(profile.data?.avatar_url ?? null);
  const invite = profile.data?.invite_code
    ? formatInviteCode(profile.data.invite_code)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Profil {displayName}</DialogTitle>
          <DialogDescription>Detail kontak percakapan</DialogDescription>
        </DialogHeader>

        {/* Big avatar */}
        <div className="relative bg-[var(--wa-surface-2,theme(colors.muted.DEFAULT))]">
          <button
            type="button"
            aria-label="Tutup"
            onClick={() => onOpenChange(false)}
            className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white hover:bg-black/60"
          >
            <X className="h-4 w-4" />
          </button>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="aspect-square w-full object-cover"
            />
          ) : (
            <div className="grid aspect-square w-full place-items-center bg-orange-950 text-6xl font-semibold text-orange-300">
              {initialOf(displayName)}
            </div>
          )}
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold">{displayName}</div>
              {invite ? (
                <div className="font-mono text-xs tabular-nums tracking-widest text-muted-foreground">
                  PIN {invite}
                </div>
              ) : null}
            </div>
            {onEditName ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit nama kontak"
                onClick={() => {
                  onOpenChange(false);
                  onEditName();
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            {onOpenAddressBook ? (
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => {
                  onOpenChange(false);
                  onOpenAddressBook();
                }}
              >
                <BookUser className="mr-2 h-4 w-4" />
                Simpan ke buku alamat
              </Button>
            ) : null}
            {profile.data?.phone ? (
              <a
                href={`tel:${profile.data.phone}`}
                className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                <PhoneIcon className="mr-2 h-4 w-4" />
                Hubungi
              </a>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
