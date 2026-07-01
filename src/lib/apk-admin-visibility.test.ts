import { describe, it, expect } from "vitest";
import {
  classifyApkAdminView,
  isAdminRequiredError,
} from "./apk-admin-visibility";
import type { AdminApkListResult } from "./apk.functions";

/**
 * Regresi UI: halaman `/pengaturan-apk` harus tetap tampil normal (banner
 * "Hanya admin", bukan crash) ketika `listApkReleaseAdminPanel` merespons
 * `{ isAdmin:false, entries:[], minSupported:{…null } }` untuk user non-admin.
 *
 * `classifyApkAdminView` adalah sumber kebenaran tunggal untuk pemilihan
 * cabang render — mengujinya sudah setara menguji perilaku UI.
 */

const NON_ADMIN_PAYLOAD: AdminApkListResult = {
  isAdmin: false,
  entries: [],
  minSupported: { storage: null, chat: null },
};

const ADMIN_PAYLOAD: AdminApkListResult = {
  isAdmin: true,
  entries: [],
  minSupported: { storage: null, chat: null },
};

describe("classifyApkAdminView — non-admin tetap tampil normal", () => {
  it("payload {isAdmin:false} dari server → tampilkan banner 'notice', bukan error/loading", () => {
    const view = classifyApkAdminView({
      isCheckingAdmin: false,
      isAdmin: false,
      isLoadingApk: false,
      isError: false,
      data: NON_ADMIN_PAYLOAD,
    });
    expect(view).toBe("notice");
  });

  it("useAdminStatus mengatakan bukan admin → banner meski data belum ada", () => {
    const view = classifyApkAdminView({
      isCheckingAdmin: false,
      isAdmin: false,
      isLoadingApk: false,
      isError: false,
      data: undefined,
    });
    expect(view).toBe("notice");
  });

  it("masih mengecek admin → loading (tidak crash / tidak flash banner)", () => {
    const view = classifyApkAdminView({
      isCheckingAdmin: true,
      isAdmin: false,
      isLoadingApk: false,
      isError: false,
      data: undefined,
    });
    expect(view).toBe("loading");
  });

  it("admin & data siap → content", () => {
    const view = classifyApkAdminView({
      isCheckingAdmin: false,
      isAdmin: true,
      isLoadingApk: false,
      isError: false,
      data: ADMIN_PAYLOAD,
    });
    expect(view).toBe("content");
  });

  it("error non-admin-gate → error branch (retry tombol)", () => {
    const view = classifyApkAdminView({
      isCheckingAdmin: false,
      isAdmin: true,
      isLoadingApk: false,
      isError: true,
      data: undefined,
    });
    expect(view).toBe("error");
  });
});

describe("isAdminRequiredError — deteksi pesan legacy", () => {
  it("mengenali 'Forbidden: admin diperlukan'", () => {
    expect(isAdminRequiredError(new Error("Forbidden: admin diperlukan"))).toBe(
      true,
    );
  });

  it("mengenali variasi tanpa prefix Forbidden", () => {
    expect(isAdminRequiredError(new Error("admin diperlukan"))).toBe(true);
  });

  it("bukan admin-gate → false (biar branch error tetap tampil)", () => {
    expect(isAdminRequiredError(new Error("Network down"))).toBe(false);
    expect(isAdminRequiredError(null)).toBe(false);
    expect(isAdminRequiredError(undefined)).toBe(false);
  });
});