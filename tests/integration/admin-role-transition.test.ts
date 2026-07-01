import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  classifyApkAdminView,
  type ApkAdminView,
} from "@/lib/apk-admin-visibility";
import type { AdminApkListResult } from "@/lib/apk.functions";

/**
 * Regresi: role user bisa berubah dari non-admin → admin di tengah sesi
 * (mis. admin lain baru memberikan peran via /pengaturan-akun-admin).
 * Sidebar & halaman `/pengaturan-apk` HARUS ikut berubah tanpa reload:
 *
 *   1. `classifyApkAdminView` transisi loading → notice → content
 *      sesuai kombinasi flag `isCheckingAdmin` / `isAdmin` / `data`.
 *   2. SSR ulang komponen route asli menghasilkan markup berbeda:
 *      "Hanya admin" hilang, form admin ("Minimum versi kompatibel") muncul.
 */

// State admin bisa diubah antar-render lewat setter modul.
let currentAdmin = { isAdmin: false, isCheckingAdmin: false };
function setAdminState(next: { isAdmin: boolean; isCheckingAdmin: boolean }) {
  currentAdmin = next;
}

// Sama untuk payload server-fn: sebelum promote → non-admin, setelah promote
// → admin dengan minSupported nyata.
const nonAdminPayload: AdminApkListResult = {
  isAdmin: false,
  entries: [],
  minSupported: { storage: null, chat: null },
};
const adminPayload: AdminApkListResult = {
  isAdmin: true,
  entries: [],
  minSupported: { storage: null, chat: null },
};
let currentPayload: AdminApkListResult = nonAdminPayload;

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

vi.mock("@/hooks/use-is-admin", () => ({
  useAdminStatus: () => currentAdmin,
  useIsAdmin: () => currentAdmin.isAdmin,
}));

vi.mock("@/lib/apk.functions", () => ({
  listApkReleaseAdmin: async () => currentPayload,
  listApkReleaseAdminPanel: async () => currentPayload,
  upsertApkReleaseMeta: async () => ({}),
  setApkMinSupported: async () => ({}),
}));

function ssrPage(
  Comp: () => ReactElement,
  seed?: { key: unknown[]; data: unknown },
): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  });
  if (seed) qc.setQueryData(seed.key, seed.data);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(Comp)),
  );
}

describe("classifyApkAdminView — transisi role saat sesi berjalan", () => {
  it("loading → notice → content sesuai perubahan flag", () => {
    // Awal: masih mengecek role.
    const t0: ApkAdminView = classifyApkAdminView({
      isCheckingAdmin: true,
      isAdmin: false,
      isLoadingApk: false,
      isError: false,
      data: undefined,
    });
    expect(t0).toBe("loading");

    // Hasil pertama: non-admin.
    const t1 = classifyApkAdminView({
      isCheckingAdmin: false,
      isAdmin: false,
      isLoadingApk: false,
      isError: false,
      data: nonAdminPayload,
    });
    expect(t1).toBe("notice");

    // Admin lain memberi role → hook re-check.
    const t2 = classifyApkAdminView({
      isCheckingAdmin: true,
      isAdmin: false,
      isLoadingApk: false,
      isError: false,
      data: nonAdminPayload,
    });
    expect(t2).toBe("loading");

    // Role terkonfirmasi admin, data admin belum sampai.
    const t3 = classifyApkAdminView({
      isCheckingAdmin: false,
      isAdmin: true,
      isLoadingApk: true,
      isError: false,
      data: undefined,
    });
    expect(t3).toBe("loading");

    // Data admin sampai.
    const t4 = classifyApkAdminView({
      isCheckingAdmin: false,
      isAdmin: true,
      isLoadingApk: false,
      isError: false,
      data: adminPayload,
    });
    expect(t4).toBe("content");
  });

  it("payload lama masih {isAdmin:false} meski hook sudah admin → tetap notice sampai refetch", () => {
    // Race: hook admin=true tapi query cache belum invalidated.
    const stale = classifyApkAdminView({
      isCheckingAdmin: false,
      isAdmin: true,
      isLoadingApk: false,
      isError: false,
      data: nonAdminPayload,
    });
    expect(stale).toBe("notice");
  });
});

describe("/pengaturan-apk — rerender saat role berubah", () => {
  beforeEach(() => {
    setAdminState({ isAdmin: false, isCheckingAdmin: false });
    currentPayload = nonAdminPayload;
  });

  it("non-admin dulu → banner; setelah promote → form admin muncul", async () => {
    const mod = await import("@/routes/_authenticated.pengaturan-apk");
    const Comp = (mod.Route as { component: () => ReactElement }).component;

    // Snapshot #1: non-admin.
    const before = ssrPage(Comp);
    expect(before).toContain("Hanya admin");
    expect(before).not.toContain("Minimum versi kompatibel");

    // Simulasi promote di tengah sesi: hook & payload keduanya berubah.
    setAdminState({ isAdmin: true, isCheckingAdmin: false });
    currentPayload = adminPayload;

    // Snapshot #2: setelah promote — sama komponen, SSR baru. Cache di-seed
    // agar useQuery langsung punya data (SSR = satu pass, tidak ada waktu
    // untuk async refetch). Ini meniru state setelah `queryClient.invalidate`
    // + fetch selesai.
    const after = ssrPage(Comp, {
      key: ["apk-release-admin"],
      data: adminPayload,
    });
    expect(after).not.toContain("Hanya admin");
    expect(after).toContain("Minimum versi kompatibel");
    expect(after).toContain("MCM Storage");
    expect(after).toContain("MCM Chat");

    // Kontrol: dua snapshot tidak boleh identik — bukti komponen benar-benar
    // merespon perubahan role, bukan cache statis.
    expect(before).not.toBe(after);
  });

  it("masih mengecek role setelah promote → tampilkan loading, bukan flash content", async () => {
    const mod = await import("@/routes/_authenticated.pengaturan-apk");
    const Comp = (mod.Route as { component: () => ReactElement }).component;

    setAdminState({ isAdmin: false, isCheckingAdmin: true });
    const html = ssrPage(Comp);
    expect(html).toContain("Memuat daftar APK");
    expect(html).not.toContain("Hanya admin");
    expect(html).not.toContain("Minimum versi kompatibel");
  });
});
