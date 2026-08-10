import { useEffect, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Versi skema dihitung di build time (vite.config.ts → __MIGRATION_VERSION__).
// Sebelumnya memakai import.meta.glob eager ?url atas 266 file migrasi, yang
// menyuntikkan ratusan URL aset ke chunk ini (~440 kB raw / 109 kB gzip) dan
// ikut terunduh di Beranda. Sekarang biayanya satu string.
declare const __MIGRATION_VERSION__: string;
const LATEST_VERSION: string | null =
  typeof __MIGRATION_VERSION__ === "string" && __MIGRATION_VERSION__
    ? __MIGRATION_VERSION__
    : null;
const ACK_KEY = "mcm:security-scan-ack-version";

function formatVersion(v: string): string {
  if (!/^\d{14}$/.test(v)) return v;
  const y = v.slice(0, 4);
  const mo = v.slice(4, 6);
  const d = v.slice(6, 8);
  const h = v.slice(8, 10);
  const mi = v.slice(10, 12);
  return `${d}/${mo}/${y} ${h}:${mi}`;
}

export function SecurityScanReminder() {
  const [acked, setAcked] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setAcked(localStorage.getItem(ACK_KEY));
    } catch {}
    setReady(true);
  }, []);

  if (!ready || !LATEST_VERSION) return null;
  if (acked === LATEST_VERSION) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(ACK_KEY, LATEST_VERSION);
    } catch {}
    setAcked(LATEST_VERSION);
  };

  return (
    <div className="mb-3 rounded-lg border border-warning/60 bg-warning p-ms-3 text-warning dark:border-warning/40 dark:bg-warning/40 dark:text-warning">
      <div className="flex items-start gap-ms-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="flex-1 text-ms-sm">
          <div className="font-medium">
            Schema database berubah ({formatVersion(LATEST_VERSION)})
          </div>
          <div className="mt-0.5 text-warning/80 dark:text-warning/80">
            Jalankan ulang security scan untuk memastikan tidak ada policy atau
            secret yang baru terekspos.
          </div>
          <div className="mt-2 flex flex-wrap gap-ms-2">
            <Button size="sm" variant="outline" onClick={dismiss}>
              Sudah dijalankan
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Tutup"
          className="rounded p-ms-1 text-warning/70 hover:bg-warning dark:text-warning/70 dark:hover:bg-warning/40"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}