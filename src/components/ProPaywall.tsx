import { Link } from "@tanstack/react-router";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  feature: string;
  description?: string;
  compact?: boolean;
};

export function ProPaywall({ feature, description, compact }: Props) {
  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary" />
          <span className="text-foreground">
            {feature} hanya untuk pelanggan <strong>Pro</strong>.
          </span>
        </div>
        <Button asChild size="sm" variant="default">
          <Link to="/langganan">Upgrade</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="mx-auto my-8 max-w-xl rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-8 text-center">
      <Sparkles className="mx-auto h-10 w-10 text-primary" />
      <h2 className="mt-3 text-xl font-semibold text-foreground">
        Fitur Pro: {feature}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {description ??
          "Modul ini hanya tersedia untuk pelanggan Pro. Mulai uji coba 14 hari gratis, tidak perlu bayar di muka."}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link to="/langganan">Lihat paket Pro</Link>
        </Button>
      </div>
    </div>
  );
}