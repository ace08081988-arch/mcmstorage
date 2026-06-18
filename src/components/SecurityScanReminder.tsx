import { useEffect, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Vite reads the migration directory at build time. The latest filename's
// timestamp prefix becomes our "schema version" — any new migration shipped
// in a deploy bumps it and re-triggers the reminder banner.
const migrationModules = import.meta.glob("/supabase/migrations/*.sql", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

function computeLatestVersion(): string | null {
  const names = Object.keys(migrationModules)
    .map((p) => p.split("/").pop() ?? "")
    .filter(Boolean)
    .sort();
  const last = names[names.length - 1];
  if (!last) return null;
  const m = last.match(/^(\d{14})/);
  return m ? m[1] : last;
}

const LATEST_VERSION = computeLatestVersion();
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
    <div className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="flex-1 text-sm">
          <div className="font-medium">
            Schema database berubah ({formatVersion(LATEST_VERSION)})
          </div>
          <div className="mt-0.5 text-amber-900/80 dark:text-amber-100/80">
            Jalankan ulang security scan untuk memastikan tidak ada policy atau
            secret yang baru terekspos.
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={dismiss}>
              Sudah dijalankan
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Tutup"
          className="rounded p-1 text-amber-900/70 hover:bg-amber-100 dark:text-amber-100/70 dark:hover:bg-amber-900/40"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}