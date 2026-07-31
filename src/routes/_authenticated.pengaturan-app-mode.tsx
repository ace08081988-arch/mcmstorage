import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppMode, getAppMode, setAppModeOverride } from "@/lib/app-mode";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { AppWindow, MessageSquare, Layers, Info } from "lucide-react";

export const Route = createFileRoute("/_authenticated/pengaturan-app-mode")({
  head: () => ({
    meta: [{ title: "Mode Aplikasi · MCM Storage" }],
  }),
  component: AppModePage,
});

function AppModePage() {
  const [mode, setMode] = useState<AppMode>(() => getAppMode());
  const navigate = useNavigate();

  useEffect(() => {
    const on = () => setMode(getAppMode());
    window.addEventListener("mcm:app-mode-change", on);
    return () => window.removeEventListener("mcm:app-mode-change", on);
  }, []);

  const envMode = (import.meta.env.VITE_APP_MODE as string | undefined) ?? "(tidak di-set)";

  const apply = (next: AppMode) => {
    setAppModeOverride(next);
    toast.success(
      next === "chat"
        ? "Mode Chat-only aktif — sidebar disederhanakan"
        : "Mode Lengkap aktif — semua menu tampil",
    );
    if (next === "chat") {
      void navigate({ to: "/chat" });
    }
  };

  const clear = () => {
    setAppModeOverride(null);
    toast.success("Override lokal dihapus — mengikuti VITE_APP_MODE build");
  };

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-10">
      <SettingsHeader
        title="Mode Aplikasi"
        subtitle="Sidebar Lengkap vs Chat-only — data & akun tetap sama"
        icon={AppWindow}
      />
      <div className="space-ms-4 px-ms-4 pt-4 sm:pt-5">
        <Card className="overflow-hidden border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-ms-sm font-semibold tracking-tight sm:text-ms-base">
              Mode aktif sekarang
            </CardTitle>
            <CardDescription className="mt-1.5">
              <span className="flex flex-wrap items-center gap-ms-2">
                <Badge
                  variant={mode === "chat" ? "default" : "secondary"}
                  className="gap-ms-1.5 px-ms-2.5 py-1 text-ms-2xs"
                >
                  {mode === "chat" ? (
                    <MessageSquare className="h-3 w-3" />
                  ) : (
                    <Layers className="h-3 w-3" />
                  )}
                  {mode === "chat" ? "Chat-only" : "Lengkap"}
                </Badge>
                <span className="text-ms-2xs text-muted-foreground">
                  Build flag{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">VITE_APP_MODE</code>
                  : <code className="text-foreground/80">{envMode}</code>
                </span>
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-ms-2 pt-0">
            <Button
              variant={mode === "full" ? "default" : "outline"}
              onClick={() => apply("full")}
              aria-pressed={mode === "full"}
              className="min-h-11 gap-ms-1.5"
            >
              <Layers className="h-4 w-4" />
              Lengkap
            </Button>
            <Button
              variant={mode === "chat" ? "default" : "outline"}
              onClick={() => apply("chat")}
              aria-pressed={mode === "chat"}
              className="min-h-11 gap-ms-1.5"
            >
              <MessageSquare className="h-4 w-4" />
              Chat-only
            </Button>
            <Button
              variant="ghost"
              onClick={clear}
              className="min-h-11 text-muted-foreground hover:text-foreground"
            >
              Hapus override lokal
            </Button>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/70 bg-muted/30 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-start gap-ms-3">
              <span
                aria-hidden
                className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15"
              >
                <Info className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-ms-sm font-semibold tracking-tight sm:text-ms-base">
                  Cara pakai untuk build permanen
                </CardTitle>
                <CardDescription className="mt-1 text-ms-xs leading-relaxed">
                  Untuk deploy versi Chat-only ke domain terpisah (mis.{" "}
                  <code className="rounded bg-background px-1 py-0.5 text-[10.5px]">
                    chat.mcmstorage.biz
                  </code>
                  ), set env{" "}
                  <code className="rounded bg-background px-1 py-0.5 text-[10.5px]">
                    VITE_APP_MODE=chat
                  </code>{" "}
                  saat build. Override di halaman ini hanya berlaku di perangkat ini.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>
    </main>
  );
}