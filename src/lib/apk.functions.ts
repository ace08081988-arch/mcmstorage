import { createServerFn } from "@tanstack/react-start";

export type LatestApk = {
  name: string;
  url: string;
  sizeMB: number | null;
  updatedAt: string | null;
} | null;

export type LatestApkVariants = {
  storage: LatestApk;
  chat: LatestApk;
};

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
    return {
      name: latest.name,
      url: signed.signedUrl,
      sizeMB: size ? Math.round((size / (1024 * 1024)) * 10) / 10 : null,
      updatedAt: latest.updated_at ?? latest.created_at ?? null,
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
      return {
        name: f.name,
        url: signed.signedUrl,
        sizeMB: size ? Math.round((size / (1024 * 1024)) * 10) / 10 : null,
        updatedAt: f.updated_at ?? f.created_at ?? null,
      };
    };
    const [storage, chat] = await Promise.all([
      toResult(storageFile),
      toResult(chatFile),
    ]);
    return { storage, chat };
  },
);