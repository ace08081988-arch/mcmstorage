import { useEffectiveSoldTotal, type SoldSource } from "@/lib/sold-total";

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
      {v.fromSales && <span className="ml-1 opacity-80">(dari catatan penjualan)</span>}
    </div>
  );
}
