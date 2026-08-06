// @vitest-environment happy-dom
/**
 * Integrasi: `registerParty` di DebtQuickActions WAJIB melewati
 * `ensureFreshSession()` sebelum INSERT ke `customers`/`suppliers`.
 *
 * Latar: `uid` dari state bisa basi setelah token rotate. Bila insert
 * memakai uid basi, RLS menolak (42501) dan user buntu. Test ini
 * mensimulasikan sesi yang sudah expired lalu mengunci tiga kontrak:
 *   1. refreshSession() dipanggil SEBELUM insert.
 *   2. Payload insert memakai uid dari sesi baru, bukan uid state.
 *   3. Bila sesi benar-benar hilang, insert TIDAK pernah terjadi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STALE_UID = "uid-stale-from-state";
const FRESH_UID = "uid-fresh-after-refresh";

type Call = { op: string; table?: string; payload?: Record<string, unknown> };
const calls: Call[] = [];
let sessionMode: "expired" | "gone" = "expired";
let refreshFails = false;
let insertError: { code?: string; message: string } | null = null;

vi.mock("@/integrations/supabase/client", () => {
  const emptyResult = { data: [], error: null };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.in = self;
  chain.match = self;
  chain.order = async () => emptyResult;
  chain.then = (res: (v: typeof emptyResult) => unknown) => Promise.resolve(emptyResult).then(res);
  return {
    supabase: {
      from: (table: string) => ({
        ...chain,
        insert: async (payload: Record<string, unknown>) => {
          calls.push({ op: "insert", table, payload });
          return { error: insertError };
        },
      }),
      auth: {
        getSession: async () => {
          calls.push({ op: "getSession" });
          if (sessionMode === "gone") return { data: { session: null }, error: null };
          return {
            data: {
              session: {
                // sudah lewat 1 jam → ensureFreshSession wajib refresh
                expires_at: Math.floor(Date.now() / 1000) - 3600,
                user: { id: STALE_UID },
              },
            },
            error: null,
          };
        },
        refreshSession: async () => {
          calls.push({ op: "refreshSession" });
          if (refreshFails) return { data: { session: null }, error: { message: "refresh failed" } };
          return { data: { session: { user: { id: FRESH_UID } } }, error: null };
        },
        signOut: async () => ({ error: null }),
      },
    },
  };
});

vi.mock("@/lib/current-user", () => ({
  getCurrentUser: async () => ({ id: STALE_UID }),
}));

const toastCalls: string[] = [];
vi.mock("sonner", () => {
  const t = Object.assign(
    (m: string) => { toastCalls.push(`msg:${m}`); return 1; },
    {
      success: (m: string) => { toastCalls.push(`success:${m}`); return 1; },
      error: (m: string) => { toastCalls.push(`error:${m}`); return 1; },
      warning: (m: string) => { toastCalls.push(`warning:${m}`); return 1; },
      info: (m: string) => { toastCalls.push(`info:${m}`); return 1; },
      loading: (m: string) => { toastCalls.push(`loading:${m}`); return 1; },
      dismiss: () => {},
    },
  );
  return { toast: t };
});

vi.mock("@/lib/contact-telemetry", () => ({
  logPartyWriteFailure: (a: unknown) => { calls.push({ op: "telemetry", payload: a as Record<string, unknown> }); },
  logAddressBookDuplicateBlock: () => {},
}));

import { DebtQuickActions } from "@/components/DebtQuickActions";

let container: HTMLDivElement;
let root: Root;

async function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <DebtQuickActions peerName="Budi" peerPhone="08123456789" />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

function findRegisterButton(): HTMLButtonElement {
  const btns = Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
  const btn = btns.find((b) => /pelanggan/i.test(b.textContent ?? ""));
  if (!btn) throw new Error(`tombol daftar pelanggan tidak ditemukan: ${container.textContent}`);
  return btn;
}

beforeEach(() => {
  calls.length = 0;
  toastCalls.length = 0;
  sessionMode = "expired";
  refreshFails = false;
  insertError = null;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe("DebtQuickActions.registerParty dengan sesi expired", () => {
  it("memanggil ensureFreshSession (refresh) sebelum insert customers", async () => {
    await renderPanel();
    await act(async () => { findRegisterButton().click(); });
    await act(async () => { await Promise.resolve(); });

    const ops = calls.map((c) => c.op);
    const iRefresh = ops.indexOf("refreshSession");
    const iInsert = ops.indexOf("insert");
    expect(ops).toContain("getSession");
    expect(iRefresh).toBeGreaterThanOrEqual(0);
    expect(iInsert).toBeGreaterThanOrEqual(0);
    expect(iRefresh).toBeLessThan(iInsert);
  });

  it("insert memakai uid hasil refresh, bukan uid basi dari state", async () => {
    await renderPanel();
    await act(async () => { findRegisterButton().click(); });
    await act(async () => { await Promise.resolve(); });

    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe("customers");
    expect(insert?.payload?.user_id).toBe(FRESH_UID);
    expect(insert?.payload?.user_id).not.toBe(STALE_UID);
    expect(insert?.payload?.name).toBe("Budi");
  });

  it("tidak pernah insert ketika sesi hilang total", async () => {
    sessionMode = "gone";
    await renderPanel();
    await act(async () => { findRegisterButton().click(); });
    await act(async () => { await Promise.resolve(); });

    expect(calls.some((c) => c.op === "insert")).toBe(false);
    expect(toastCalls.some((t) => /Sesi berakhir/i.test(t))).toBe(true);
  });

  it("tidak insert ketika refresh token ditolak server", async () => {
    refreshFails = true;
    await renderPanel();
    await act(async () => { findRegisterButton().click(); });
    await act(async () => { await Promise.resolve(); });

    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("error RLS 42501 dicatat telemetri dan memunculkan prompt masuk ulang", async () => {
    insertError = { code: "42501", message: "new row violates row-level security policy" };
    await renderPanel();
    await act(async () => { findRegisterButton().click(); });
    await act(async () => { await Promise.resolve(); });

    expect(calls.some((c) => c.op === "telemetry")).toBe(true);
    expect(toastCalls.some((t) => /^error:Gagal mendaftarkan pelanggan/.test(t))).toBe(true);
  });
});
