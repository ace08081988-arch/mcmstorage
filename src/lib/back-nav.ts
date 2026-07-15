import type { useRouter } from "@tanstack/react-router";

type Router = ReturnType<typeof useRouter>;
// TanStack's NavigateOptions is a heavily-typed union; call sites pass
// route-literal objects that widen to `string`, so accept anything the
// router itself accepts and let its runtime handle it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NavigateOptions = any;

/**
 * Kembali ke halaman sebelumnya bila ada history di dalam sesi router ini;
 * kalau tidak (mis. dibuka dari deep link / share link), navigasi hirarkis
 * ke `fallback`. Membuat perilaku tombol "Kembali" konsisten di semua mode
 * chat: chat list, percakapan, audit, dan pengaturan profil chat.
 */
export function goBackOr(router: Router, fallback: NavigateOptions) {
  const state = router.history.location.state as
    | { __TSR_index?: number }
    | undefined;
  const idx = typeof state?.__TSR_index === "number" ? state.__TSR_index : 0;
  if (idx > 0) {
    router.history.back();
    return;
  }
  router.navigate(fallback);
}