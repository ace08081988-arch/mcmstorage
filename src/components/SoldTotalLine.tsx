import { useEffectiveSoldTotal, type SoldSource } from "@/lib/sold-total";

const SOURCE_LABEL: Record<
  import("@/lib/sold-total").SoldTotalSource,
  string
> = {
  sold_total: "dari sold_total",
  sales: "dari total penjualan asal paket",
  none: "belum tercatat",
};

/**
 * Baris "Nilai penjualan" seragam untuk semua kartu paket.
 * Angka & formatnya mengikuti SSOT di src/lib/sold-total.ts.
 */
export function SoldTotalLine({
  source,
  sourceId,
  soldTotal,
  sold,
  className,
}: {
  source: SoldSource;
  sourceId: string | null | undefined;
  soldTotal: number | string | null | undefined;
  sold: boolean;
  className?: string;
}) {
  const v = useEffectiveSoldTotal(source, sourceId, soldTotal, sold);
  return (
    <div className={className}>
      Nilai penjualan: <b>{v.label}</b>
      <span className="ml-1.5 text-[11px] text-muted-foreground">
        ({SOURCE_LABEL[v.source]})
      </span>
    </div>
  );
}
