import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  debtSyncStatus,
  fetchDebtSyncMap,
  useDebtSyncMap,
} from "@/lib/chat-debt-sync";
import { DebtChip, debtChipTone } from "@/components/chat/DebtChip";
import { rupiah } from "@/lib/stock-format";

/**
 * Chip catatan hutang/piutang di kartu/pratinjau daftar chat.
 *
 * Memakai `DebtChip` yang sama dengan header percakapan agar tampilan
 * identik di semua lokasi, dan SELALU dirender (netral "Catatan Rp 0"
 * saat kontak belum tertaut ke buku Hutang & Piutang).
 */
export function DebtSyncBadge({ title }: { title: string | null | undefined }) {
  const { data: map } = useDebtSyncMap();
  const status = debtSyncStatus(title, map);
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

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
      qc.setQueryData(["chat", "debt-sync"], fresh);
      const next = debtSyncStatus(title, fresh);
      if (next.state === "unlinked") {
        toast.info(`Belum ada catatan hutang/piutang atas nama "${title ?? "-"}"`, {
          description: "Buat entri di halaman Hutang & Piutang dengan nama yang sama agar tersinkron.",
        });
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
        <button
          type="button"
          onClick={resync}
          disabled={syncing}
          aria-label="Sinkronkan ulang hutang piutang"
          className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-ms-2xs text-primary disabled:opacity-60"
        >
          <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Menyinkron…" : "Sinkronkan"}
        </button>
      ) : null}
    </span>
  );
}
