import type { ComponentType, ReactNode, SVGProps } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * SettingsSection — opt-in shared shell for settings cards.
 * Pages that want the same look-and-feel as other /pengaturan-* pages
 * can wrap their content in this. Existing pages are not required to use it.
 */
export function SettingsSection({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("overflow-hidden border-border/70 shadow-sm", className)}>
      <CardHeader className="gap-ms-1 pb-3 sm:pb-4">
        <div className="flex items-start gap-ms-3">
          {Icon ? (
            <span
              aria-hidden
              className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15"
            >
              <Icon className="h-4.5 w-4.5" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <CardTitle className="text-ms-sm font-semibold tracking-tight sm:text-ms-base">
              {title}
            </CardTitle>
            {description ? (
              <CardDescription className="mt-1 text-ms-xs leading-relaxed">
                {description}
              </CardDescription>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </CardHeader>
      <CardContent className={cn("pt-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}