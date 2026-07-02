import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type LatestApk = {
  name: string;
  url: string;
  sizeMB: number | null;
  updatedAt: string | null;
  versionName: string | null;
  versionCode: number | null;
  belowMinimum: boolean;
} | null;

export type LatestApkVariants = {
  storage: LatestApk;
  chat: LatestApk;
  minSupported: {
    storage: MinSupported | null;
    chat: MinSupported | null;
  };
};

export type ApkVariant = "storage" | "chat";

export type ApkRelease = {
  name: string;
  url: string;
  sizeMB: number | null;
  updatedAt: string | null;
  versionName: string | null;
  versionCode: number | null;
  belowMinimum: boolean;
};

export type ApkVariantDetail = {
  variant: ApkVariant;
  title: string;
  subtitle: string;
  latest: ApkRelease | null;
  releases: ApkRelease[];
  changelog: string | null;
  minSupported: MinSupported | null;
};

const isChatName = (n: string) => /(^|[-_.])chat([-_.]|$)/i.test(n);

export type MinSupported = {
  variant: ApkVariant;
  min_version_name: string | null;
  min_version_code: number | null;
  reason: string | null;
  updated_at: string;
};

/**
 * Bandingkan semver kasar. Contoh:
 *   compareSemver("1.2.3", "1.10.0") < 0
 *   compareSemver("1.2", "1.2.0")   === 0   // segmen hilang = 0
 *   compareSemver("1.2.3-beta", "1.2.3") === 0  // prerelease diabaikan
 * Non-digit dalam segmen di-strip; segmen kosong = 0.
 */
export function compareSemver(a: string, b: string): number {
  const norm = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(/[-+]/, 1)[0]
      .split(".")
      .map((seg) => {
        const digits = seg.replace(/\D+/g, "");
        return digits.length ? Number.parseInt(digits, 10) : 0;
      });
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

/**
 * Apakah rilis dianggap di bawah minimum yang ditetapkan?
 *
 * Aturan ketat (AND-gabungan): untuk setiap field minimum yang di-set,
 * rilis wajib memiliki nilai padanan DAN nilai itu ≥ minimum. Bila rilis
 * kekurangan data padanan untuk sebuah field yang diminimumkan, rilis
 * dianggap **di bawah minimum** (tidak dapat dibuktikan kompatibel).
 *
 * - Kedua field minimum kosong → tidak ada kebijakan → false.
 * - min_version_code diset: butuh versionCode finite, integer, ≥ min.
 * - min_version_name diset: butuh versionName valid, semver ≥ min.
 * Bila keduanya diset, KEDUANYA harus lolos.
 */
export function isBelowMinimum(
  release: { versionName: string | null; versionCode: number | null },
  min: MinSupported | null,
): boolean {
  if (!min) return false;
  const hasMinCode = min.min_version_code !== null;
  const hasMinName = !!min.min_version_name;
  if (!hasMinCode && !hasMinName) return false;

  if (hasMinCode) {
    const rc = release.versionCode;
    if (rc === null || !Number.isFinite(rc) || !Number.isInteger(rc)) {
      return true;
    }
    if (rc < (min.min_version_code as number)) return true;
  }
  if (hasMinName) {
    const rn = release.versionName;
    if (!rn || !/\d/.test(rn)) return true;
    if (compareSemver(rn, min.min_version_name as string) < 0) return true;
  }
  return false;
}

async function loadMinSupportedMap(): Promise<
  Partial<Record<ApkVariant, MinSupported>>
> {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const { data } = await supabaseAdmin
    .from("apk_min_supported")
    .select("variant, min_version_name, min_version_code, reason, updated_at");
  const out: Partial<Record<ApkVariant, MinSupported>> = {};
  for (const row of (data ?? []) as MinSupported[]) {
    out[row.variant] = row;
  }
  return out;
}

export type ApkReleaseMeta = {
  file_name: string;
  variant: ApkVariant;
  enabled: boolean;
  publish_at: string | null;
  notes: string | null;
  updated_at: string;
};

type MetaMap = Map<string, ApkReleaseMeta>;

async function loadReleaseMetaMap(): Promise<MetaMap> {
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const { data } = await supabaseAdmin
    .from("apk_release_meta")
    .select("file_name, variant, enabled, publish_at, notes, updated_at");
  const m: MetaMap = new Map();
  for (const row of (data ?? []) as ApkReleaseMeta[]) {
    m.set(row.file_name, row);
  }
  return m;
}

/**
 * Sebuah berkas APK "terlihat publik" jika:
 *   - tidak ada meta (default aktif), ATAU
 *   - enabled=true DAN (publish_at IS NULL atau publish_at <= now)
 */
function isPublic(name: string, meta: MetaMap): boolean {
  const row = meta.get(name);
  if (!row) return true;
  if (!row.enabled) return false;
  if (row.publish_at && Date.parse(row.publish_at) > Date.now()) return false;
  return true;
}

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
    const meta = await loadReleaseMetaMap();
    const mins = await loadMinSupportedMap();
    const apks = data
      .filter((f) => /\.apk$/i.test(f.name))
      .filter((f) => isPublic(f.name, meta));
    if (apks.length === 0) return null;
    const latest = apks[0];
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(latest.name, 60 * 60, { download: latest.name });
    if (signErr || !signed?.signedUrl) return null;
    const size = (latest.metadata as { size?: number } | null)?.size ?? null;
    const parsed = parseApkFileName(latest.name);
    const variant: ApkVariant = isChatName(latest.name) ? "chat" : "storage";
    return {
      name: latest.name,
      url: signed.signedUrl,
      sizeMB: size ? Math.round((size / (1024 * 1024)) * 10) / 10 : null,
      updatedAt: latest.updated_at ?? latest.created_at ?? null,
      versionName: parsed.versionName,
      versionCode: parsed.versionCode,
      belowMinimum: isBelowMinimum(parsed, mins[variant] ?? null),
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
    if (error || !data) {
      return {
        storage: null,
        chat: null,
        minSupported: { storage: null, chat: null },
      };
    }
    const meta = await loadReleaseMetaMap();
    const mins = await loadMinSupportedMap();
    const apks = data
      .filter((f) => /\.apk$/i.test(f.name))
      .filter((f) => isPublic(f.name, meta));
    const chatFile = apks.find((f) => isChatName(f.name)) ?? null;
    const storageFile = apks.find((f) => !isChatName(f.name)) ?? null;
    const toResult = async (
      f: typeof apks[number] | null,
      variant: ApkVariant,
    ): Promise<LatestApk> => {
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
        belowMinimum: isBelowMinimum(parsed, mins[variant] ?? null),
      };
    };
    const [storage, chat] = await Promise.all([
      toResult(storageFile, "storage"),
      toResult(chatFile, "chat"),
    ]);
    return {
      storage,
      chat,
      minSupported: {
        storage: mins.storage ?? null,
        chat: mins.chat ?? null,
      },
    };
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
      const meta = await loadReleaseMetaMap();
      const mins = await loadMinSupportedMap();
      const minForVariant = mins[data.variant] ?? null;
      const apks = files
        .filter((f) => /\.apk$/i.test(f.name))
        .filter((f) =>
          data.variant === "chat" ? isChatName(f.name) : !isChatName(f.name),
        )
        .filter((f) => isPublic(f.name, meta));
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
            belowMinimum: isBelowMinimum(parsed, minForVariant),
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
      minSupported: (await loadMinSupportedMap())[data.variant] ?? null,
    };
  });

// ============================================================================
// Admin: kelola jadwal & status rilis
// ============================================================================

export type AdminApkEntry = {
  file_name: string;
  variant: ApkVariant;
  sizeMB: number | null;
  uploadedAt: string | null;
  versionName: string | null;
  versionCode: number | null;
  enabled: boolean;
  publish_at: string | null;
  notes: string | null;
  status: "published" | "scheduled" | "disabled";
  belowMinimum: boolean;
};

export type AdminApkListResult = {
  isAdmin: boolean;
  entries: AdminApkEntry[];
  minSupported: {
    storage: MinSupported | null;
    chat: MinSupported | null;
  };
};

// Menggunakan `any` di sini karena tipe context dari middleware
// tidak diekspor & bervariasi; RPC tetap type-safe via nama literal.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) {
    const { logAdminDenial } = await import("./admin-denial-telemetry");
    logAdminDenial({ fn: "apk:requireAdmin", userId: context.userId });
    throw new Error("Forbidden: admin diperlukan");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkAdmin(context: any): Promise<boolean> {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) return false;
  return Boolean(data);
}

function computeStatus(
  enabled: boolean,
  publish_at: string | null,
): "published" | "scheduled" | "disabled" {
  if (!enabled) return "disabled";
  if (publish_at && Date.parse(publish_at) > Date.now()) return "scheduled";
  return "published";
}

// Diekspor untuk uji regresi kontrak non-admin — lihat
// `tests/integration/apk-admin-list-non-admin.test.ts`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildAdminApkList(context: any): Promise<AdminApkListResult> {
  // Non-admin: return an empty payload with a flag instead of throwing.
  // Throwing di sini menyebabkan blank screen & runtime-error report untuk
  // user biasa yang tanpa sengaja membuka /pengaturan-apk. Aksi tulis
  // (`upsertApkReleaseMeta`, `setApkMinSupported`) tetap dijaga strict.
  const isAdmin = await checkAdmin(context);
  if (!isAdmin) {
    return {
      isAdmin: false,
      entries: [],
      minSupported: { storage: null, chat: null },
    };
  }
  const { supabaseAdmin } = await import(
    "@/integrations/supabase/client.server"
  );
  const BUCKET = "apk-releases";
  const { data: files } = await supabaseAdmin.storage
    .from(BUCKET)
    .list("", {
      limit: 500,
      sortBy: { column: "updated_at", order: "desc" },
    });
  const apks = (files ?? []).filter((f) => /\.apk$/i.test(f.name));
  const meta = await loadReleaseMetaMap();
  const mins = await loadMinSupportedMap();
  const entries = apks.map<AdminApkEntry>((f) => {
    const row = meta.get(f.name);
    const variant: ApkVariant = isChatName(f.name) ? "chat" : "storage";
    const enabled = row?.enabled ?? true;
    const publish_at = row?.publish_at ?? null;
    const size = (f.metadata as { size?: number } | null)?.size ?? null;
    const parsed = parseApkFileName(f.name);
    return {
      file_name: f.name,
      variant,
      sizeMB: size ? Math.round((size / (1024 * 1024)) * 10) / 10 : null,
      uploadedAt: f.updated_at ?? f.created_at ?? null,
      versionName: parsed.versionName,
      versionCode: parsed.versionCode,
      enabled,
      publish_at,
      notes: row?.notes ?? null,
      status: computeStatus(enabled, publish_at),
      belowMinimum: isBelowMinimum(parsed, mins[variant] ?? null),
    };
  });
  return {
    isAdmin: true,
    entries,
    minSupported: {
      storage: mins.storage ?? null,
      chat: mins.chat ?? null,
    },
  };
}

export const listApkReleaseAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminApkListResult> =>
    buildAdminApkList(context),
  );

// Export baru supaya route memakai manifest server-function segar dan tidak
// tersangkut cache handler lama yang masih memanggil requireAdmin untuk read.
export const listApkReleaseAdminPanel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminApkListResult> =>
    buildAdminApkList(context),
  );

export const upsertApkReleaseMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      file_name: string;
      enabled: boolean;
      publish_at: string | null;
      notes?: string | null;
    }) => {
      if (!data.file_name || typeof data.file_name !== "string") {
        throw new Error("file_name wajib diisi");
      }
      if (typeof data.enabled !== "boolean") {
        throw new Error("enabled wajib boolean");
      }
      if (data.publish_at !== null && Number.isNaN(Date.parse(data.publish_at))) {
        throw new Error("publish_at tidak valid");
      }
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const variant: ApkVariant = isChatName(data.file_name) ? "chat" : "storage";
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("apk_release_meta")
      .upsert(
        {
          file_name: data.file_name,
          variant,
          enabled: data.enabled,
          publish_at: data.publish_at,
          notes: data.notes ?? null,
          updated_by: context.userId,
        },
        { onConflict: "file_name" },
      );
    if (error) throw new Error(error.message);
    return {
      ok: true,
      status: computeStatus(data.enabled, data.publish_at),
    };
  });

export const setApkMinSupported = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      variant: ApkVariant;
      min_version_name: string | null;
      min_version_code: number | null;
      reason: string | null;
    }) => {
      if (data.variant !== "storage" && data.variant !== "chat") {
        throw new Error("Varian tidak dikenal");
      }
      if (
        data.min_version_name !== null &&
        !/^\d+\.\d+(\.\d+){0,2}$/.test(data.min_version_name)
      ) {
        throw new Error("min_version_name harus format semver (mis. 1.2.3)");
      }
      if (
        data.min_version_code !== null &&
        (!Number.isFinite(data.min_version_code) || data.min_version_code < 0)
      ) {
        throw new Error("min_version_code harus bilangan bulat ≥ 0");
      }
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin.from("apk_min_supported").upsert(
      {
        variant: data.variant,
        min_version_name: data.min_version_name,
        min_version_code: data.min_version_code,
        reason: data.reason,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "variant" },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// ---------- Download click analytics (admin) ----------
export type ApkDownloadStatsRow = {
  variant: "storage" | "chat";
  source: "button" | "copy_page" | "copy_file";
  total: number;
  last24h: number;
  last7d: number;
};

export type ApkDownloadStats = {
  rows: ApkDownloadStatsRow[];
  totals: {
    storage: { button: number; total: number };
    chat: { button: number; total: number };
    windowStart: string;
  };
  recent: Array<{
    id: string;
    variant: "storage" | "chat";
    source: "button" | "copy_page" | "copy_file";
    created_at: string;
    referrer: string | null;
    user_agent: string | null;
  }>;
};

export const getApkDownloadStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ApkDownloadStats> => {
    await requireAdmin(context);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await context.supabase
      .from("apk_download_events")
      .select("id,variant,source,created_at,referrer,user_agent")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    const now = Date.now();
    const t24 = now - 24 * 60 * 60 * 1000;
    const t7d = now - 7 * 24 * 60 * 60 * 1000;
    const bucket = new Map<string, ApkDownloadStatsRow>();
    const totals = {
      storage: { button: 0, total: 0 },
      chat: { button: 0, total: 0 },
      windowStart: since,
    };
    for (const row of data ?? []) {
      const variant = row.variant as "storage" | "chat";
      const source = row.source as "button" | "copy_page" | "copy_file";
      const key = `${variant}:${source}`;
      const created = new Date(row.created_at).getTime();
      const cur = bucket.get(key) ?? {
        variant,
        source,
        total: 0,
        last24h: 0,
        last7d: 0,
      };
      cur.total += 1;
      if (created >= t24) cur.last24h += 1;
      if (created >= t7d) cur.last7d += 1;
      bucket.set(key, cur);
      totals[variant].total += 1;
      if (source === "button") totals[variant].button += 1;
    }
    return {
      rows: Array.from(bucket.values()).sort((a, b) => b.total - a.total),
      totals,
      recent: (data ?? []).slice(0, 20).map((r) => ({
        id: r.id as string,
        variant: r.variant as "storage" | "chat",
        source: r.source as "button" | "copy_page" | "copy_file",
        created_at: r.created_at as string,
        referrer: (r.referrer as string | null) ?? null,
        user_agent: (r.user_agent as string | null) ?? null,
      })),
    };
  });