import { useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export function SettingsHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 bg-background/95 px-4 py-3 backdrop-blur">
      <button
        type="button"
        aria-label="Kembali"
        onClick={() => router.history.back()}
        className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold leading-tight">{title}</h1>
        {subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
    </header>
  );
}