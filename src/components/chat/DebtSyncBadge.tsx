import { Link2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  DEBT_SYNC_QUERY_KEY,
  PARTY_LINK_QUERY_KEY,
  debtSyncStatus,
  fetchDebtSyncMap,
  savePartyLink,
  suggestPartyMatches,
  useDebtSyncMap,
  usePartyLinks,
} from "@/lib/chat-debt-sync";
import { DebtChip, debtChipTone } from "@/components/chat/DebtChip";
import { rupiah } from "@/lib/stock-format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Chip catatan hutang/piutang di kartu/pratinjau daftar chat.
 *
 * Memakai `DebtChip` yang sama dengan header percakapan agar tampilan
 * identik di semua lokasi, dan SELALU dirender (netral "Catatan Rp 0"
 * saat kontak belum tertaut ke buku Hutang & Piutang).
 */
export function DebtSyncBadge({ title }: { title: string | null | undefined }) {
  const { data: map } = useDebtSyncMap();
  const { data: links } = usePartyLinks();
  const status = debtSyncStatus(title, map, links);
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Kandidat nama mirip di buku hutang/piutang — mengatasi beda ejaan.
  const candidates = useMemo(
    () => (status.state === "unlinked" ? suggestPartyMatches(title, map) : []),
    [status.state, title, map],
  );

  const hutang = status.state === "unlinked" ? 0 : status.entry.hutang;
  const piutang = status.state === "unlinked" ? 0 : status.entry.piutang;
  const tone = debtChipTone(hutang, piutang, status.state !== "unlinked");
  const amount = tone === "hutang" ? hutang : piutang;

  // Ambil ulang data hutang/piutang dari SSOT, lalu laporkan hasilnya.
  // Tetap frontend-only: tidak membuat entri hutang apa pun secara diam-diam.
  const resync = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (syncing) return;
    setSyncing(true);
    try {
      const fresh = await fetchDebtSyncMap();
      qc.setQueryData(DEBT_SYNC_QUERY_KEY, fresh);
      const next = debtSyncStatus(title, fresh, links);
      if (next.state === "unlinked") {
        const near = suggestPartyMatches(title, fresh);
        if (near.length > 0) {
          setPickerOpen(true);
        } else {
          toast.info(`Belum ada catatan hutang/piutang atas nama "${title ?? "-"}"`, {
            description:
              "Buat entri di halaman Hutang & Piutang, atau tautkan manual ke nama yang sudah ada.",
          });
        }
      } else {
        toast.success("Tersinkron", {
          description:
            next.state === "settled"
              ? "Tidak ada sisa hutang/piutang."
              : `Piutang ${rupiah(next.entry.piutang)} · Hutang ${rupiah(next.entry.hutang)}`,
        });
      }
    } catch (err) {
      toast.error("Gagal sinkronkan", {
        description: err instanceof Error ? err.message : "Coba lagi saat koneksi stabil.",
      });
    } finally {
      setSyncing(false);
    }
  };

  const linkTo = async (partyName: string) => {
    try {
      await savePartyLink((title ?? "").trim(), partyName);
      await qc.invalidateQueries({ queryKey: PARTY_LINK_QUERY_KEY });
      setPickerOpen(false);
      toast.success("Tertaut", {
        description: `"${title}" kini memakai catatan "${partyName}".`,
      });
    } catch (err) {
      toast.error("Gagal menautkan", {
        description: err instanceof Error ? err.message : "Coba lagi.",
      });
    }
  };

  return (
    <span className="flex shrink-0 items-center gap-1">
      <DebtChip
        tone={tone}
        amount={amount}
        compactOnly
        interactive={false}
        title={
          tone === "empty"
            ? "Belum tertaut ke buku Hutang & Piutang"
            : tone === "settled"
              ? "Tersinkron — tidak ada sisa hutang/piutang"
              : tone === "piutang"
                ? `Piutang belum dibayar: ${rupiah(piutang)}`
                : `Hutang saya: ${rupiah(hutang)}`
        }
      />
      {tone === "empty" ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (candidates.length > 0) setPickerOpen(true);
              else void resync(e);
            }}
            disabled={syncing}
            aria-label="Sinkronkan ulang hutang piutang"
            // Mobile (<=430px): tombol ikon 24px tanpa label supaya lebar
            // preview percakapan tidak tergerus. Label teks kembali muncul
            // mulai 431px.
            className="inline-flex h-6 w-6 items-center justify-center gap-1 rounded-full border border-primary/40 bg-primary/10 text-ms-2xs text-primary disabled:opacity-60 min-[431px]:h-auto min-[431px]:w-auto min-[431px]:px-1.5 min-[431px]:py-0.5"
          >
            {candidates.length > 0 ? (
              <Link2 className="h-3 w-3" />
            ) : (
              <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
            )}
            <span className="hidden min-[431px]:inline">
              {syncing ? "Menyinkron…" : candidates.length > 0 ? "Tautkan" : "Sinkronkan"}
            </span>
          </button>

          <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
            <DialogContent
              className="chat-field-scope max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <DialogHeader>
                <DialogTitle>Tautkan “{title}”</DialogTitle>
                <DialogDescription>
                  Nama di chat berbeda ejaan dengan buku Hutang &amp; Piutang.
                  Pilih catatan yang benar agar saldonya tersinkron di semua
                  halaman.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {suggestPartyMatches(title, map, 8).map((c) => (
                  <button
                    key={c.entry.name}
                    type="button"
                    onClick={() => void linkTo(c.entry.name)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.entry.name}</span>
                      <span className="block text-ms-2xs text-muted-foreground">
                        Piutang {rupiah(c.entry.piutang)} · Hutang {rupiah(c.entry.hutang)}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-ms-2xs text-primary">
                      {Math.round(c.score * 100)}% mirip
                    </span>
                  </button>
                ))}
                {suggestPartyMatches(title, map, 8).length === 0 ? (
                  <p className="text-ms-2xs text-muted-foreground">
                    Tidak ada nama mirip. Buat entri baru di halaman Hutang &amp; Piutang.
                  </p>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </span>
  );
}
