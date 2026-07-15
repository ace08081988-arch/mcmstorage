import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Download, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logStorageError } from "@/lib/storage-log";

const BUCKET = "apk-releases";

type ApkInfo = {
  name: string;
  url: string;
  sizeMB: number | null;
  updatedAt: string | null;
};

function formatMB(bytes: number | null | undefined): number | null {
  if (!bytes) return null;
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

export function ApkDownloadBanner() {
  const [apk, setApk] = useState<ApkInfo | null>(null);
  const [ready, setReady] = useState(false);

  // Sembunyikan jika sudah dibuka dari APK (Capacitor native)
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (isNative) {
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .list("", {
            limit: 50,
            sortBy: { column: "updated_at", order: "desc" },
          });
        if (error || !data) {
          logStorageError({ bucket: BUCKET, op: "list", path: "", source: "ApkDownloadBanner" }, error);
          setReady(true);
          return;
        }
        const apks = data.filter((f) => /\.apk$/i.test(f.name));
        if (apks.length === 0) {
          setReady(true);
          return;
        }
        const latest = apks[0];
        const { data: signed, error: signErr } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(latest.name, 60 * 60, {
            download: latest.name,
          });
        logStorageError(
          { bucket: BUCKET, op: "createSignedUrl", path: latest.name, source: "ApkDownloadBanner" },
          signErr,
        );
        if (cancelled) return;
        setApk({
          name: latest.name,
          url: signed?.signedUrl ?? "",
          sizeMB: formatMB(
            (latest.metadata as { size?: number } | null)?.size ?? null,
          ),
          updatedAt: latest.updated_at ?? latest.created_at ?? null,
        });
      } catch {
        // diamkan; banner tidak muncul
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNative]);

  if (!ready || isNative || !apk || !apk.url) return null;

  return (
    <a
      href={apk.url}
      className="flex items-start gap-ms-3 rounded-xl border border-success/60 bg-success p-ms-3 text-success transition hover:bg-success dark:border-success/40 dark:bg-success/40 dark:text-success dark:hover:bg-success/60"
    >
      <div className="rounded-lg bg-success/10 p-ms-2 text-success dark:text-success">
        <Smartphone className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-ms-1.5 text-ms-sm font-semibold">
          Unduh aplikasi Android
          <Download className="h-3.5 w-3.5" />
        </div>
        <div className="mt-0.5 text-ms-2xs text-success/80 dark:text-success/80">
          MCM Storage untuk HP
          {apk.sizeMB ? ` · ${apk.sizeMB} MB` : ""}
          {apk.updatedAt
            ? ` · ${new Date(apk.updatedAt).toLocaleDateString("id-ID")}`
            : ""}
        </div>
      </div>
    </a>
  );
}