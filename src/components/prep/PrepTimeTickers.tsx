import { useEffect, useState } from "react";
import { Clock, Lock } from "lucide-react";

/**
 * Detak lokal untuk label berbasis waktu. Ditaruh di komponen daun kecil
 * supaya hanya label itu yang rerender — bukan seluruh portal + kartu foto.
 * Berhenti saat tab tidak terlihat agar hemat baterai.
 */
export function useSecondsTicker(intervalMs: number, enabled = true) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((n) => n + 1);
    }, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") setTick((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs, enabled]);
}

/** Lama penahanan reload versi baru (detik) — timer internal sendiri. */
export function DeferredHoldSeconds({ since }: { since: number }) {
  useSecondsTicker(1000);
  return <>{Math.max(0, Math.round((Date.now() - since) / 1000))}</>;
}

/** Umur data terakhir sinkron, dengan timer internal 5 detik. */
export function SyncAgeLabel({ lastSyncAt }: { lastSyncAt: number }) {
  useSecondsTicker(5000);
  return <>{Math.max(0, Math.round((Date.now() - lastSyncAt) / 1000))}</>;
}

/**
 * Hitung mundur sesi PIN. Parent hanya memberi waktu expiry absolut;
 * seluruh detak per detik terisolasi di komponen ini.
 */
export function SessionCountdown({
  expiresAt,
  onRelogin,
}: {
  expiresAt: number;
  onRelogin: () => void;
}) {
  useSecondsTicker(1000);
  const secondsLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  const clock = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;
  return (
    <div className="mx-auto flex max-w-2xl items-center justify-between gap-ms-2 px-ms-4 pb-2 text-ms-2xs">
      <span
        className={
          "inline-flex items-center gap-ms-1 rounded-full border px-ms-2 py-0.5 font-medium tabular-nums " +
          (secondsLeft <= 60
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : secondsLeft <= 300
              ? "border-warning/30 bg-warning/10 text-warning dark:text-warning"
              : "border-border bg-muted/60 text-muted-foreground")
        }
        title={`Sesi PIN aktif sampai ${new Date(expiresAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`}
      >
        <Clock className="h-3 w-3" />
        Sesi {clock}
      </span>
      {secondsLeft <= 300 ? (
        <button
          type="button"
          onClick={onRelogin}
          className={
            "inline-flex items-center gap-ms-1 rounded-full px-ms-2.5 py-0.5 text-ms-2xs font-semibold text-white shadow-sm transition " +
            (secondsLeft <= 60 ? "bg-destructive hover:bg-destructive/90" : "bg-warning hover:bg-warning")
          }
          title="Masuk ulang dengan PIN sekarang"
        >
          <Lock className="h-3 w-3" />
          Re-login sekarang
        </button>
      ) : (
        <span className="text-muted-foreground">
          {`Re-login pada ${new Date(expiresAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`}
        </span>
      )}
    </div>
  );
}

