import { createServerFn } from "@tanstack/react-start";

export type LatestApk = {
  name: string;
  url: string;
  sizeMB: number | null;
  updatedAt: string | null;
  versionName: string | null;
  versionCode: number | null;
} | null;

export type LatestApkVariants = {
  storage: LatestApk;
  chat: LatestApk;
};

/**
 * Ekstrak versionName + versionCode dari nama berkas APK.
 *
 * Format yang didukung (dari konvensi build Android/Capacitor umum):
 *   - `mcm-storage-v1.2.3-45.apk`      → 1.2.3 / 45
 *   - `mcm-chat_1.2.3(45).apk`         → 1.2.3 / 45
 *   - `app-release-1.2.3+45.apk`       → 1.2.3 / 45
 *   - `mcm-1.2.3-build45.apk`          → 1.2.3 / 45
 *   - `mcm-1.2.3.apk`                  → 1.2.3 / null
 *
 * Jika pola tidak cocok, kembalikan null di kedua field — kartu tetap
 * menampilkan info lain (ukuran & tanggal) tanpa membingungkan user.
 */
export function parseApkFileName(name: string): {
  versionName: string | null;
  versionCode: number | null;
} {
  const base = name.replace(/\.apk$/i, "");
  // versionName: cari angka X.Y[.Z[.W]] pertama (didahului opsional 'v').
  const vn = base.match(/(?:^|[^\d])v?(\d+\.\d+(?:\.\d+){0,2})/i);
  const versionName = vn ? vn[1] : null;

  let versionCode: number | null = null;
  if (versionName) {
    // Setelah versionName, cari build number dengan berbagai separator.
    const afterIdx = base.indexOf(versionName) + versionName.length;
    const tail = base.slice(afterIdx);
    const bc =
      tail.match(/^[\s._-]*build[\s._-]*(\d+)/i) ||
      tail.match(/^[\s._-]*b(\d+)/i) ||
      tail.match(/^\((\d+)\)/) ||
      tail.match(/^\+(\d+)/) ||
      tail.match(/^[._-](\d+)(?!\d*\.)/);
    if (bc) versionCode = Number(bc[1]);
  }
  return { versionName, versionCode };
}

export const getLatestApk = createServerFn({ method: "GET" }).handler(
  async (): Promise<LatestApk> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const BUCKET = "apk-releases";
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list("", {
        limit: 100,
        sortBy: { column: "updated_at", order: "desc" },
      });
    if (error || !data) return null;
    const apks = data.filter((f) => /\.apk$/i.test(f.name));
    if (apks.length === 0) return null;
    const latest = apks[0];
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(latest.name, 60 * 60, { download: latest.name });
    if (signErr || !signed?.signedUrl) return null;
    const size = (latest.metadata as { size?: number } | null)?.size ?? null;
    const parsed = parseApkFileName(latest.name);
    return {
      name: latest.name,
      url: signed.signedUrl,
      sizeMB: size ? Math.round((size / (1024 * 1024)) * 10) / 10 : null,
      updatedAt: latest.updated_at ?? latest.created_at ?? null,
      versionName: parsed.versionName,
      versionCode: parsed.versionCode,
    };
  },
);

export const getLatestApkVariants = createServerFn({ method: "GET" }).handler(
  async (): Promise<LatestApkVariants> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const BUCKET = "apk-releases";
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list("", {
        limit: 200,
        sortBy: { column: "updated_at", order: "desc" },
      });
    if (error || !data) return { storage: null, chat: null };
    const apks = data.filter((f) => /\.apk$/i.test(f.name));
    const isChat = (n: string) => /(^|[-_.])chat([-_.]|$)/i.test(n);
    const chatFile = apks.find((f) => isChat(f.name)) ?? null;
    const storageFile = apks.find((f) => !isChat(f.name)) ?? null;
    const toResult = async (f: typeof apks[number] | null): Promise<LatestApk> => {
      if (!f) return null;
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(f.name, 60 * 60, { download: f.name });
      if (signErr || !signed?.signedUrl) return null;
      const size = (f.metadata as { size?: number } | null)?.size ?? null;
      const parsed = parseApkFileName(f.name);
      return {
        name: f.name,
        url: signed.signedUrl,
        sizeMB: size ? Math.round((size / (1024 * 1024)) * 10) / 10 : null,
        updatedAt: f.updated_at ?? f.created_at ?? null,
        versionName: parsed.versionName,
        versionCode: parsed.versionCode,
      };
    };
    const [storage, chat] = await Promise.all([
      toResult(storageFile),
      toResult(chatFile),
    ]);
    return { storage, chat };
  },
);