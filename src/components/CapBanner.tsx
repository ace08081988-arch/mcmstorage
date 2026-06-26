import { Link } from "@tanstack/react-router";
import { Lock, AlertTriangle } from "lucide-react";
import { useEntitlement } from "@/hooks/useEntitlement";

type Kind = "warehouseItems" | "salesLast30Days" | "staffContacts" | "devices";

const LABEL: Record<Kind, string> = {
  warehouseItems: "barang gudang",
  salesLast30Days: "penjualan (30 hari terakhir)",
  staffContacts: "kontak pegawai",
  devices: "perangkat tepercaya",
};

/**
 * Proactive cap warning for Free-tier users. Renders nothing for Pro users
 * or when usage is well under the limit. Pair with DB triggers
 * (`enforce_free_*_cap`) which provide the actual hard block.
 */
export function CapBanner({ kind, className = "" }: { kind: Kind; className?: string }) {
  const ent = useEntitlement();
  if (ent.loading || ent.isPro) return null;
  const used = ent.usage[kind];
  const cap = ent.caps[kind];
  if (cap <= 0 || used < Math.max(1, cap - 2)) return null;

  const atCap = used >= cap;
  const Icon = atCap ? Lock : AlertTriangle;
  const tone = atCap
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : "border-amber-400/40 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300";

  return (
    <div
      role={atCap ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${tone} ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <div className="font-semibold">
          {atCap
            ? `Batas paket Free tercapai (${used}/${cap} ${LABEL[kind]}).`
            : `Hampir mencapai batas Free (${used}/${cap} ${LABEL[kind]}).`}
        </div>
        <div className="mt-0.5 leading-snug">
          {atCap
            ? "Penambahan baru akan ditolak server. Data lama tetap bisa diedit."
            : "Pertimbangkan upgrade ke Pro untuk kapasitas tak terbatas."}{" "}
          <Link to="/langganan" className="underline font-medium">
            Lihat paket Pro
          </Link>
        </div>
      </div>
    </div>
  );
}