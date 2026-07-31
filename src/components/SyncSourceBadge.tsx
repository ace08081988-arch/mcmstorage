import { Laptop, Radio } from "lucide-react";

/**
 * Badge kecil untuk header dialog/preview. Menunjukkan apakah update
 * sinkron terakhir berasal dari tab ini (`self`) atau dari tab/sesi lain
 * via storage event (`external`). Membantu operator memahami kenapa
 * status berubah tanpa ia melakukan apa-apa.
 */
export function SyncSourceBadge({
  source,
  active,
  className = "",
}: {
  source: "self" | "external" | null;
  active: boolean;
  className?: string;
}) {
  if (!active || !source) return null;
  const isExternal = source === "external";
  const Icon = isExternal ? Radio : Laptop;
  const label = isExternal ? "Tab lain" : "Tab ini";
  const title = isExternal
    ? "Update sinkron terakhir berasal dari tab/sesi lain (storage event)."
    : "Update sinkron terakhir berasal dari tab ini.";
  const tone = isExternal
    ? "border-warning/40 bg-warning/10 text-warning dark:text-warning"
    : "border-success/40 bg-success/10 text-success dark:text-success";
  return (
    <span
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-ms-1 rounded-full border px-1.5 py-0.5 text-ms-2xs font-medium leading-none ${tone} ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      <span>{label}</span>
    </span>
  );
}