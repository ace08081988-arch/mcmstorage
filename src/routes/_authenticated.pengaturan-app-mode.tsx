import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppMode, getAppMode, setAppModeOverride } from "@/lib/app-mode";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Mode Aplikasi</h1>
        <p className="text-sm text-muted-foreground">
          Atur tampilan sidebar antara <b>Lengkap</b> (semua fitur) atau
          <b> Chat-only</b> (hanya Komunikasi, Akun, Sistem). Data & akun
          tetap sama.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mode aktif sekarang</CardTitle>
          <CardDescription>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant={mode === "chat" ? "default" : "secondary"}>
                {mode === "chat" ? "Chat-only" : "Lengkap"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Build flag <code className="rounded bg-muted px-1">VITE_APP_MODE</code>:{" "}
                <code>{envMode}</code>
              </span>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant={mode === "full" ? "default" : "outline"}
            onClick={() => apply("full")}
          >
            Lengkap
          </Button>
          <Button
            variant={mode === "chat" ? "default" : "outline"}
            onClick={() => apply("chat")}
          >
            Chat-only
          </Button>
          <Button variant="ghost" onClick={clear}>
            Hapus override lokal
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cara pakai untuk build permanen</CardTitle>
          <CardDescription>
            Untuk deploy versi Chat-only ke domain terpisah (mis.
            <code className="mx-1">chat.mcmstorage.biz</code>), set env
            <code className="mx-1">VITE_APP_MODE=chat</code> saat build.
            Override di halaman ini hanya berlaku di perangkat ini.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}