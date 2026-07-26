import { CircleSlash, HandCoins, Wallet, CheckCircle2 } from "lucide-react";
import { debtSyncStatus, useDebtSyncMap } from "@/lib/chat-debt-sync";
import { rupiah } from "@/lib/stock-format";

/**
 * Chip kecil di pratinjau chat: apakah kontak ini sudah tersinkron ke
 * buku Hutang & Piutang, dan berapa sisanya. Data di-cache satu query
 * bersama untuk seluruh daftar (react-query dedupe).
 */
export function DebtSyncBadge({ title }: { title: string | null | undefined }) {
  const { data: map } = useDebtSyncMap();
  const status = debtSyncStatus(title, map);

  if (status.state === "unlinked") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--wa-border)] px-1.5 py-0.5 text-ms-2xs text-[var(--wa-text-muted)]"
        title="Belum tertaut ke buku Hutang & Piutang"
      >
        <CircleSlash className="h-3 w-3" />
        Belum sinkron
      </span>
    );
  }

  if (status.state === "settled") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-ms-2xs text-emerald-500"
        title="Tersinkron — tidak ada sisa hutang/piutang"
      >
        <CheckCircle2 className="h-3 w-3" />
        Lunas
      </span>
    );
  }

  const { hutang, piutang } = status.entry;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {piutang > 0 ? (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-ms-2xs text-amber-500"
          title={`Piutang belum dibayar: ${rupiah(piutang)}`}
        >
          <HandCoins className="h-3 w-3" />
          {rupiah(piutang)}
        </span>
      ) : null}
      {hutang > 0 ? (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-ms-2xs text-rose-500"
          title={`Hutang saya: ${rupiah(hutang)}`}
        >
          <Wallet className="h-3 w-3" />
          {rupiah(hutang)}
        </span>
      ) : null}
    </span>
  );
}
