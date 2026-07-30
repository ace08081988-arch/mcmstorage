/**
 * Pemberitahuan keamanan draft form.
 *
 * Dua kondisi lapangan yang bikin ketikan hilang tanpa penjelasan:
 *  1) localStorage ditolak (private mode / storage diblokir / kuota penuh)
 *     → draft hanya bertahan di memori halaman.
 *  2) offline → draft aman, tapi tombol Simpan akan gagal ke server.
 * Komponen ini menjelaskan keduanya dengan bahasa yang jelas.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CloudOff, Save, WifiOff } from "lucide-react";
import type { DraftStatus } from "@/lib/form-draft";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setOnline(window.navigator.onLine !== false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function DraftSafetyNotice({
  status,
  savedAt,
  className = "",
}: {
  status: DraftStatus;
  savedAt: number | null;
  className?: string;
}) {
  const online = useOnlineStatus();

  const rows: Array<{ key: string; tone: "warn" | "danger" | "muted"; icon: React.ReactNode; text: string }> = [];

  if (status === "memory") {
    rows.push({
      key: "memory",
      tone: "warn",
      icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" />,
      text: "Penyimpanan perangkat diblokir/penuh. Ketikan tetap tersimpan sementara di memori halaman — aman saat bagian ini dipulihkan, tapi hilang bila aplikasi ditutup atau halaman dimuat ulang. Selesaikan & simpan sekarang.",
    });
  } else if (status === "none") {
    rows.push({
      key: "none",
      tone: "danger",
      icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" />,
      text: "Draft tidak bisa disimpan sama sekali di perangkat ini. Jangan tutup halaman sebelum menekan Simpan.",
    });
  }

  if (!online) {
    rows.push({
      key: "offline",
      tone: "warn",
      icon: <WifiOff className="h-3.5 w-3.5 shrink-0" />,
      text: "Sedang offline. Isian tidak akan hilang, tapi tombol Simpan baru berhasil setelah internet kembali — coba lagi saat sinyal ada.",
    });
  }

  if (rows.length === 0) {
    if (status === "ok" && savedAt) {
      return (
        <p className={`flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground ${className}`}>
          <Save className="h-3 w-3 shrink-0" />
          Draft tersimpan otomatis {fmtTime(savedAt)} — aman bila halaman dipulihkan.
        </p>
      );
    }
    return null;
  }

  return (
    <div className={`space-y-1.5 ${className}`} role="status" aria-live="polite">
      {rows.map((r) => (
        <div
          key={r.key}
          className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-[0.6875rem] leading-snug ${
            r.tone === "danger"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          }`}
        >
          {r.icon}
          <span>{r.text}</span>
        </div>
      ))}
      {status === "memory" && savedAt ? (
        <p className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          <CloudOff className="h-3 w-3 shrink-0" />
          Cadangan memori terakhir {fmtTime(savedAt)}.
        </p>
      ) : null}
    </div>
  );
}
