import { Link } from "@tanstack/react-router";
import { AlertTriangle, Clock, Sparkles } from "lucide-react";
import { useEntitlement } from "@/hooks/useEntitlement";

export function SubscriptionBanner() {
  const ent = useEntitlement();
  if (ent.loading || !ent.uid) return null;

  // Expired/free with prior subscription history
  if (!ent.isPro && ent.status === "expired") {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs">
        <span className="flex items-center gap-2 text-foreground">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          Langganan Pro Anda sudah berakhir. Beberapa fitur dikunci.
        </span>
        <Link
          to="/langganan"
          className="rounded-md bg-primary px-2 py-0.5 font-medium text-primary-foreground hover:bg-primary/90"
        >
          Perpanjang
        </Link>
      </div>
    );
  }

  // Pro nearing expiry (7 days)
  if (ent.isPro && ent.daysLeft !== null && ent.daysLeft <= 7) {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs">
        <span className="flex items-center gap-2 text-foreground">
          <Clock className="h-3.5 w-3.5 text-amber-600" />
          Pro Anda berakhir {ent.daysLeft === 0 ? "hari ini" : `dalam ${ent.daysLeft} hari`}.
        </span>
        <Link
          to="/langganan"
          className="rounded-md bg-primary px-2 py-0.5 font-medium text-primary-foreground hover:bg-primary/90"
        >
          Perpanjang
        </Link>
      </div>
    );
  }

  // Free user who never tried Pro: subtle nudge
  if (!ent.isPro && ent.status === "none" && !ent.trialUsedAt) {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-primary/30 bg-primary/5 px-3 py-1.5 text-xs">
        <span className="flex items-center gap-2 text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Coba Pro gratis 14 hari — buka chat, hutang-piutang, dan multi-perangkat.
        </span>
        <Link
          to="/langganan"
          className="rounded-md bg-primary px-2 py-0.5 font-medium text-primary-foreground hover:bg-primary/90"
        >
          Mulai uji coba
        </Link>
      </div>
    );
  }
  return null;
}