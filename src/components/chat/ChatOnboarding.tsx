import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MessageCircle, UserPlus, Users, QrCode, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isChatOnly } from "@/lib/app-mode";

const LS_KEY = "mcm.chat.onboarding.dismissed";

interface Props {
  onStartDm?: () => void;
  onNewGroup?: () => void;
  onShowQr?: () => void;
}

/**
 * Empty state + onboarding ringan untuk daftar chat.
 * Muncul saat tidak ada percakapan sama sekali. Bisa ditutup — status
 * simpan di localStorage supaya tidak mengganggu setelah pengguna paham.
 */
export function ChatOnboarding({ onStartDm, onNewGroup, onShowQr }: Props) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(LS_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(LS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const chatMode = isChatOnly();

  if (dismissed) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center">
        <MessageCircle className="mx-auto mb-2 h-10 w-10 text-muted-foreground" />
        <p className="text-sm font-medium">Belum ada percakapan</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Tambah kontak dulu supaya bisa mulai ngobrol atau menelepon.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button size="sm" asChild className="gap-1.5">
            <Link to="/kontak">
              <UserPlus className="h-4 w-4" /> Tambah kontak
            </Link>
          </Button>
          {onStartDm ? (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onStartDm}>
              <MessageCircle className="h-4 w-4" /> Mulai chat
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const steps = [
    {
      icon: UserPlus,
      title: "Tambah kontak lewat PIN",
      desc: "Minta PIN 8-karakter atau scan QR teman untuk saling terhubung.",
      cta: (
        <Button asChild size="sm" variant="secondary" className="gap-1.5">
          <Link to="/kontak">
            <UserPlus className="h-4 w-4" /> Ke Kontak
          </Link>
        </Button>
      ),
    },
    {
      icon: MessageCircle,
      title: "Mulai percakapan pribadi",
      desc: "Ketuk ikon chat baru untuk memulai obrolan satu lawan satu.",
      cta: onStartDm ? (
        <Button size="sm" variant="secondary" className="gap-1.5" onClick={onStartDm}>
          <MessageCircle className="h-4 w-4" /> Chat baru
        </Button>
      ) : null,
    },
    {
      icon: Users,
      title: "Buat grup untuk tim",
      desc: "Kumpulkan tim, pelanggan, atau keluarga dalam satu grup.",
      cta: onNewGroup ? (
        <Button size="sm" variant="secondary" className="gap-1.5" onClick={onNewGroup}>
          <Users className="h-4 w-4" /> Grup baru
        </Button>
      ) : null,
    },
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-4 sm:p-5">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Tutup panduan"
        className="absolute right-2 top-2 rounded-full p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight">
            {chatMode ? "Selamat datang di MCM Chat" : "Selamat datang di chat"}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ikuti 3 langkah singkat berikut supaya siap ngobrol, telepon, dan
            berbagi status.
          </p>
        </div>
      </div>

      <ol className="mt-4 space-y-3">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className="flex items-start gap-3 rounded-xl border bg-background/60 p-3"
          >
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <s.icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-muted-foreground">
                  LANGKAH {i + 1}
                </span>
              </div>
              <p className="text-sm font-medium leading-snug">{s.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.desc}</p>
              {s.cta ? <div className="mt-2">{s.cta}</div> : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        {onShowQr ? (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={onShowQr}>
            <QrCode className="h-4 w-4" /> Bagikan PIN / QR saya
          </Button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={dismiss}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Nanti saja
        </button>
      </div>
    </div>
  );
}