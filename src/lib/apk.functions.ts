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

export type ApkVariant = "storage" | "chat";

export type ApkRelease = {
  name: string;
  url: string;
  sizeMB: number | null;
  updatedAt: string | null;
  versionName: string | null;
  versionCode: number | null;
};

export type ApkVariantDetail = {
  variant: ApkVariant;
  title: string;
  subtitle: string;
  latest: ApkRelease | null;
  releases: ApkRelease[];
  changelog: string | null;
};

const isChatName = (n: string) => /(^|[-_.])chat([-_.]|$)/i.test(n);

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
    const chatFile = apks.find((f) => isChatName(f.name)) ?? null;
    const storageFile = apks.find((f) => !isChatName(f.name)) ?? null;
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

export const getApkVariantDetail = createServerFn({ method: "GET" })
  .inputValidator(
    (data: { variant: ApkVariant }) => {
      if (data.variant !== "storage" && data.variant !== "chat") {
        throw new Error("Varian tidak dikenal");
      }
      return data;
    },
  )
  .handler(async ({ data }): Promise<ApkVariantDetail> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const BUCKET = "apk-releases";
    const meta: Record<ApkVariant, { title: string; subtitle: string }> = {
      storage: {
        title: "MCM Storage",
        subtitle:
          "APK fitur lengkap: gudang, penjualan, hutang piutang, ecer, chat.",
      },
      chat: {
        title: "MCM Chat",
        subtitle: "APK khusus komunikasi. Ringan, terpisah, akun sama.",
      },
    };

    const { data: files, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list("", {
        limit: 500,
        sortBy: { column: "updated_at", order: "desc" },
      });
    let releases: ApkRelease[] = [];
    if (!error && files) {
      const apks = files
        .filter((f) => /\.apk$/i.test(f.name))
        .filter((f) =>
          data.variant === "chat" ? isChatName(f.name) : !isChatName(f.name),
        );
      releases = await Promise.all(
        apks.map(async (f) => {
          const { data: signed } = await supabaseAdmin.storage
            .from(BUCKET)
            .createSignedUrl(f.name, 60 * 60, { download: f.name });
          const size = (f.metadata as { size?: number } | null)?.size ?? null;
          const parsed = parseApkFileName(f.name);
          return {
            name: f.name,
            url: signed?.signedUrl ?? "",
            sizeMB: size
              ? Math.round((size / (1024 * 1024)) * 10) / 10
              : null,
            updatedAt: f.updated_at ?? f.created_at ?? null,
            versionName: parsed.versionName,
            versionCode: parsed.versionCode,
          };
        }),
      );
      // Urutkan: versionCode desc, lalu updatedAt desc.
      releases.sort((a, b) => {
        if (a.versionCode !== null && b.versionCode !== null) {
          return b.versionCode - a.versionCode;
        }
        const at = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return bt - at;
      });
    }

    // Ambil changelog markdown dari bucket bila tersedia.
    let changelog: string | null = null;
    const changelogNames = [
      `changelog-${data.variant}.md`,
      `CHANGELOG-${data.variant}.md`,
      `changelog_${data.variant}.md`,
    ];
    for (const name of changelogNames) {
      const { data: blob } = await supabaseAdmin.storage
        .from(BUCKET)
        .download(name);
      if (blob) {
        changelog = await blob.text();
        break;
      }
    }

    return {
      variant: data.variant,
      title: meta[data.variant].title,
      subtitle: meta[data.variant].subtitle,
      latest: releases[0] ?? null,
      releases,
      changelog,
    };
  });