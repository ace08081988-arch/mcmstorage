import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Sane defaults untuk mengurangi re-fetch berlebihan saat balik ke tab
  // atau reconnect network. Query yang butuh live update (chat realtime,
  // notifikasi, dsb.) opt-in per-query via `refetchOnWindowFocus: true`.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: "always",
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Prefetch chunk + loader rute saat pointer/tap mendekat, jadi pindah
    // halaman terasa instan (terutama di WebView Android yang lambat).
    defaultPreload: "intent",
    defaultPreloadDelay: 60,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
