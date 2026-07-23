/**
 * Fetch/save template WA per-owner ke tabel `wa_message_templates`.
 * Fallback ke DEFAULT_TEMPLATE + DEFAULT_OPTIONS bila belum ada baris.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_OPTIONS,
  DEFAULT_TEMPLATE,
  type WaTemplateOptions,
} from "./wa-template";

export type WaTemplateRecord = {
  template: string;
  options: WaTemplateOptions;
};

let memCache: WaTemplateRecord | null = null;
let inflight: Promise<WaTemplateRecord> | null = null;

export function getCachedWaTemplate(): WaTemplateRecord {
  return memCache ?? { template: DEFAULT_TEMPLATE, options: { ...DEFAULT_OPTIONS } };
}

export async function loadWaTemplate(force = false): Promise<WaTemplateRecord> {
  if (!force && memCache) return memCache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data: uData } = await supabase.auth.getUser();
      const uid = uData.user?.id;
      if (!uid) throw new Error("no-session");
      const { data, error } = await supabase
        .from("wa_message_templates")
        .select("template, options")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) throw error;
      const rec: WaTemplateRecord = {
        template: data?.template ?? DEFAULT_TEMPLATE,
        options: { ...DEFAULT_OPTIONS, ...((data?.options as Partial<WaTemplateOptions>) ?? {}) },
      };
      memCache = rec;
      return rec;
    } catch {
      const rec = { template: DEFAULT_TEMPLATE, options: { ...DEFAULT_OPTIONS } };
      memCache = rec;
      return rec;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function saveWaTemplate(rec: WaTemplateRecord): Promise<void> {
  const { data: uData, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  const uid = uData.user?.id;
  if (!uid) throw new Error("Belum login");
  const { error } = await supabase
    .from("wa_message_templates")
    .upsert(
      {
        user_id: uid,
        template: rec.template,
        options: rec.options as unknown as Record<string, unknown>,
      },
      { onConflict: "user_id" },
    );
  if (error) throw error;
  memCache = rec;
  window.dispatchEvent(new CustomEvent("mcm:wa-template-change"));
}

/** Hook ringan untuk komponen non-suspense (Ecer/Request dialog). */
export function useWaTemplate(): WaTemplateRecord {
  const [rec, setRec] = useState<WaTemplateRecord>(getCachedWaTemplate);
  const refresh = useCallback(() => {
    loadWaTemplate().then(setRec).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const on = () => refresh();
    window.addEventListener("mcm:wa-template-change", on);
    return () => window.removeEventListener("mcm:wa-template-change", on);
  }, [refresh]);
  return rec;
}
