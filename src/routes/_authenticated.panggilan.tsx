import { createFileRoute, Link } from "@tanstack/react-router";
import { Phone, PhoneMissed, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatBottomNav } from "@/components/chat/ChatBottomNav";

export const Route = createFileRoute("/_authenticated/panggilan")({
  component: PanggilanPage,
  head: () => ({
    meta: [
      { title: "Panggilan · MCM" },
      { name: "description", content: "Riwayat panggilan suara & video MCM Chat." },
    ],
  }),
});

function PanggilanPage() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col wa-surface">
      <header className="wa-header sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-3">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label="Kembali">
          <Link to="/chat"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <h1 className="text-lg font-semibold">Panggilan</h1>
      </header>

      <div className="flex-1 px-4 py-8">
        <div className="mx-auto max-w-sm space-y-3 rounded-2xl border bg-card p-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
            <PhoneMissed className="h-6 w-6" />
          </div>
          <h2 className="text-base font-semibold">Belum ada panggilan</h2>
          <p className="text-xs text-muted-foreground">
            Riwayat panggilan suara & video akan muncul di sini. Mulai panggilan
            dari dalam percakapan.
          </p>
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/chat"><Phone className="h-4 w-4" /> Buka daftar chat</Link>
          </Button>
        </div>
      </div>

      <ChatBottomNav />
    </main>
  );
}