import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTurnstileSiteKey } from "@/lib/turnstile-config.functions";

/**
 * Site key Turnstile aktif (DB → fallback env).
 * Fallback awal ke VITE_TURNSTILE_SITE_KEY supaya widget tidak menunggu
 * roundtrip pertama; DB value menggantikan saat query selesai.
 */
export function useTurnstileSiteKey(): { siteKey: string; isLoading: boolean } {
  const envKey =
    (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? "";
  const fetcher = useServerFn(getTurnstileSiteKey);
  const q = useQuery({
    queryKey: ["turnstile", "site-key"],
    queryFn: () => fetcher(),
    staleTime: 60_000,
    retry: false,
  });
  return {
    siteKey: (q.data?.siteKey?.trim() || envKey),
    isLoading: q.isLoading && !envKey,
  };
}