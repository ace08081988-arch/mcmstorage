import type { QueryClient } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";

/**
 * Navigasi terpusat saat pengguna mengetuk notifikasi (Web Push, notifikasi
 * lokal, atau push native). Tujuannya satu: sekali diketuk, aplikasi langsung
 * berada di halaman yang relevan DENGAN data yang sudah disegarkan.
 */

export type NotifTarget = {
  pathname: string;
  search: Record<string, string>;
  conversationId?: string;
};

/** Pecah URL notifikasi (boleh absolut/relatif) menjadi path + query. */
export function parseNotificationUrl(raw: string): NotifTarget {
  let pathname = "/";
  let search: Record<string, string> = {};
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const u = new URL(raw, base);
    pathname = u.pathname || "/";
    u.searchParams.forEach((v, k) => {
      search[k] = v;
    });
  } catch {
    pathname = raw.startsWith("/") ? raw : `/${raw}`;
    search = {};
  }
  const m = /^\/chat\/([^/]+)/.exec(pathname);
  return { pathname, search, conversationId: m ? decodeURIComponent(m[1]) : undefined };
}

/** Query key yang perlu disegarkan agar halaman tujuan tidak menampilkan data basi. */
function invalidationKeysFor(pathname: string): string[][] {
  if (pathname.startsWith("/chat")) return [["chat"], ["conversations"], ["messages"]];
  if (pathname.startsWith("/panggilan")) return [["calls"], ["chat"]];
  if (pathname.startsWith("/tugas") || pathname.startsWith("/t/")) return [["tugas"], ["prep"]];
  if (pathname.startsWith("/request")) return [["request"], ["prep"]];
  if (pathname.startsWith("/notifikasi")) return [["notifications"]];
  if (pathname.startsWith("/hutang") || pathname.startsWith("/piutang")) return [["hutang"], ["piutang"]];
  return [];
}

/** Tandai percakapan sudah dibaca (dipakai aksi cepat & param `markRead=1`). */
export async function markConversationRead(conversationId: string): Promise<void> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", u.user.id);
}

/**
 * Buka halaman tujuan notifikasi lalu segarkan datanya.
 * Aman dipanggil dari service worker message, deep link native, atau tombol UI.
 */
export async function navigateFromNotification(
  router: AnyRouter,
  queryClient: QueryClient,
  rawUrl: string,
): Promise<void> {
  const { pathname, search, conversationId } = parseNotificationUrl(rawUrl);

  // Aksi "tandai dibaca" bisa ikut menempel pada URL (cold start dari SW).
  const shouldMarkRead = search.markRead === "1" && !!conversationId;
  const cleanSearch = { ...search };
  delete cleanSearch.markRead;

  try {
    await router.navigate({
      to: pathname,
      search: cleanSearch,
      replace: false,
    } as never);
  } catch {
    const qs = new URLSearchParams(cleanSearch).toString();
    window.location.href = qs ? `${pathname}?${qs}` : pathname;
    return;
  }

  if (shouldMarkRead && conversationId) {
    try {
      await markConversationRead(conversationId);
    } catch {
      /* non-fatal */
    }
  }

  for (const queryKey of invalidationKeysFor(pathname)) {
    queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * Cold start: aplikasi dibuka langsung dari notifikasi (SW `openWindow`).
 * Bersihkan parameter aksi (`markRead=1`) dan jalankan efeknya sekali.
 */
export async function handleColdStartNotification(queryClient: QueryClient): Promise<void> {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("markRead") !== "1") return;
  const { conversationId } = parseNotificationUrl(url.pathname);
  url.searchParams.delete("markRead");
  window.history.replaceState({}, "", url.pathname + (url.search || "") + url.hash);
  if (!conversationId) return;
  try {
    await markConversationRead(conversationId);
    queryClient.invalidateQueries({ queryKey: ["chat"] });
  } catch {
    /* non-fatal */
  }
}
