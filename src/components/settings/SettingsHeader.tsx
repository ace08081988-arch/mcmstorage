import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { cn } from "@/lib/utils";

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * SettingsHeader — shared sticky header for every /pengaturan-* page.
 *
 * API is backward compatible: existing pages that only pass `title` and
 * `subtitle` keep working unchanged. Added optional props let pages surface
 * a category icon, right-side actions, or a status pill (e.g. "Tersimpan").
 */
export function SettingsHeader({
  title,
  subtitle,
  icon: Icon = SettingsIcon,
  actions,
  status,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  status?: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <header
      className={cn(
        "sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70",
        className,
      )}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-ms-3 px-ms-3 py-ms-2.5 sm:px-ms-4 sm:py-ms-3">
        <button
          type="button"
          aria-label="Kembali"
          onClick={() => router.history.back()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span
          aria-hidden
          className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15 sm:grid"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-ms-2">
            <h1 className="truncate text-ms-base font-semibold leading-tight tracking-tight sm:text-ms-lg">
              {title}
            </h1>
            {status ? <span className="shrink-0">{status}</span> : null}
          </div>
          {subtitle ? (
            <p className="truncate text-ms-2xs leading-snug text-muted-foreground sm:text-ms-xs">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-ms-1.5">{actions}</div> : null}
      </div>
    </header>
  );
}