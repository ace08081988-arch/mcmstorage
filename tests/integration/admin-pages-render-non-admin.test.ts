import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Integration: halaman admin yang memakai `listApkReleaseAdmin(Panel)` &
 * `getEmailQueueStatus` tetap render normal untuk non-admin — tidak crash,
 * tidak blank, tidak melempar exception dari server-fn.
 *
 * Strategi: SSR renderToStaticMarkup komponen route asli lalu cek markup
 * mengandung banner/empty-state yang diharapkan. Kalau branch banner
 * salah (misal render lolos ke `<VariantSection>` yang butuh data admin),
 * SSR akan melempar / string kosong dan test ini gagal — bukti bahwa
 * halaman tidak "blank screen" untuk non-admin.
 *
 * `createFileRoute` di-mock ke identitas supaya `Route.component` bisa
 * diambil tanpa router registry. `Link` juga di-mock ke `<a>` sederhana
 * agar tidak butuh `RouterProvider`.
 */

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    createFileRoute:
      (_path: string) =>
      (opts: Record<string, unknown>) => ({ ...opts, options: opts }),
    Link: ({ to, children, className }: { to?: string; children?: unknown; className?: string }) =>
      createElement("a", { href: to ?? "#", className }, children as never),
  };
});

vi.mock("@tanstack/react-start", () => ({
  useServerFn: <T,>(fn: T) => fn,
  createServerFn: () => {
    const chain: Record<string, unknown> = {};
    chain.middleware = () => chain;
    chain.inputValidator = () => chain;
    chain.handler = (h: unknown) => h;
    return chain;
  },
}));

// useAdminStatus → non-admin, sudah selesai mengecek.
vi.mock("@/hooks/use-is-admin", () => ({
  useAdminStatus: () => ({ isAdmin: false, isCheckingAdmin: false }),
  useIsAdmin: () => false,
}));

// Server-fn implementations di-stub. Ini yang bikin non-admin sekarang
// dapat payload aman, bukan `throw new Error("Forbidden: admin diperlukan")`.
vi.mock("@/lib/apk.functions", () => ({
  listApkReleaseAdmin: async () => ({
    isAdmin: false,
    entries: [],
    minSupported: { storage: null, chat: null },
  }),
  listApkReleaseAdminPanel: async () => ({
    isAdmin: false,
    entries: [],
    minSupported: { storage: null, chat: null },
  }),
  upsertApkReleaseMeta: async () => ({}),
  setApkMinSupported: async () => ({}),
}));

vi.mock("@/lib/email-queue.functions", () => ({
  getEmailQueueStatus: async () => ({
    isAdmin: false,
    health: null,
    recentOtp: [],
    cronProcessLastRun: null,
    cronProcessNextRun: null,
  }),
  resendDeviceOtpByMessage: async () => ({ ok: false, error: "forbidden" }),
}));

function ssr(element: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, element),
  );
}

describe("halaman admin — render non-admin tidak crash / blank", () => {
  beforeEach(() => vi.clearAllMocks());

  it("/pengaturan-apk: banner 'Hanya admin' tampil, bukan blank", async () => {
    const mod = await import("@/routes/_authenticated.pengaturan-apk");
    const Comp = (mod.Route as { component: () => ReactElement }).component;

    const html = ssr(createElement(Comp));

    expect(html.length).toBeGreaterThan(50); // bukti bukan blank string
    expect(html).toContain("Hanya admin");
    expect(html).toContain("Pengaturan rilis APK");
    // Non-admin TIDAK boleh melihat form admin.
    expect(html).not.toContain("Minimum versi kompatibel");
    expect(html).not.toContain("Belum ada berkas APK");
  });

  it("/email-queue: fallback 'hanya untuk admin' tampil, header tetap ada", async () => {
    const mod = await import("@/routes/_authenticated.email-queue");
    const Comp = (mod.Route as { component: () => ReactElement }).component;

    const html = ssr(createElement(Comp));

    expect(html.length).toBeGreaterThan(50);
    expect(html).toContain("Status Antrian Email");
    expect(html.toLowerCase()).toContain("hanya untuk admin");
    // Tidak boleh render tabel/summary yang butuh payload admin.
    expect(html).not.toContain("Antrian tertunda");
    expect(html).not.toContain("DLQ");
  });

  it("SSR non-admin TIDAK melempar (regresi 'Forbidden: admin diperlukan')", async () => {
    const apk = await import("@/routes/_authenticated.pengaturan-apk");
    const eq = await import("@/routes/_authenticated.email-queue");
    const ApkComp = (apk.Route as { component: () => ReactElement }).component;
    const EqComp = (eq.Route as { component: () => ReactElement }).component;

    expect(() => ssr(createElement(ApkComp))).not.toThrow();
    expect(() => ssr(createElement(EqComp))).not.toThrow();
  });
});
