// @vitest-environment happy-dom
/**
 * Self-test: mensimulasikan urutan onAuthStateChange TOKEN_REFRESHED yang
 * mengirim `session=null` sesaat (kondisi umum di WebView Android /
 * reconnect / INITIAL_SESSION saat token sedang di-hydrate). Kontrak yang
 * dijaga:
 *
 *  1. `useAdminStatus` TIDAK me-reset `userId` untuk event non-SIGNED_OUT
 *     dengan session=null, sehingga `isAdmin` tetap `true` selama window
 *     transient — hanya `SIGNED_OUT` yang benar-benar melogout.
 *  2. Konsumen yang meniru pola sticky-gate TugasBaruPage (form dirender
 *     selamanya setelah admin sekali terkonfirmasi) TETAP mounted dan
 *     nilai input yang sudah diketik user TIDAK kembali ke draft/0 saat
 *     event TOKEN_REFRESHED null datang.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// ── Fixtures untuk supabase mock ────────────────────────────────────────
type AuthEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "PASSWORD_RECOVERY"
  | "MFA_CHALLENGE_VERIFIED";
type AuthListener = (event: AuthEvent, session: { user: { id: string } } | null) => void;

const ADMIN_ID = "admin-user-1";
let getUserResolver: (u: { id: string } | null) => void = () => {};
let getUserPromise: Promise<void> = Promise.resolve();
let listeners: AuthListener[] = [];
let rpcImpl: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }> =
  async () => ({ data: true, error: null });

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      auth: {
        getUser: () => {
          getUserPromise = new Promise<void>((resolve) => {
            getUserResolver = (u) => {
              resolve();
              // Kembalikan bentuk yang sama dengan supabase-js
              return { data: { user: u }, error: null };
            };
          });
          // Kembalikan Promise yang resolve saat test memanggil resolver.
          return new Promise((resolve) => {
            getUserResolver = (u) => {
              resolve({ data: { user: u }, error: null });
            };
          });
        },
        onAuthStateChange: (cb: AuthListener) => {
          listeners.push(cb);
          return {
            data: {
              subscription: {
                unsubscribe: () => {
                  listeners = listeners.filter((l) => l !== cb);
                },
              },
            },
          };
        },
      },
      rpc: (name: string, args: unknown) => rpcImpl(name, args),
    },
  };
});

// Import HARUS setelah vi.mock supaya hook memakai supabase yang di-mock.
import { useAdminStatus } from "../use-is-admin";
import { __resetCurrentUserCacheForTests } from "@/lib/current-user";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function emitAuth(event: AuthEvent, userId: string | null) {
  const session = userId ? { user: { id: userId } } : null;
  for (const l of [...listeners]) l(event, session);
}

function mount(node: React.ReactNode): { root: Root; host: HTMLDivElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<>{node}</>);
  });
  return { root, host };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

beforeEach(() => {
  listeners = [];
  rpcImpl = async () => ({ data: true, error: null });
  document.body.innerHTML = "";
  // Cache identitas user hidup di level modul — reset supaya hasil test
  // sebelumnya (mis. SIGNED_OUT) tidak bocor ke test berikutnya.
  __resetCurrentUserCacheForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAdminStatus · TOKEN_REFRESHED dengan session null tidak mereset admin", () => {
  it("isAdmin tetap true selama event non-SIGNED_OUT membawa session=null", async () => {
    const client = makeClient();
    let latest: ReturnType<typeof useAdminStatus> | null = null;
    function Probe() {
      latest = useAdminStatus();
      return null;
    }
    const { root } = mount(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );

    // getUser resolve dengan admin id → ready=true, userId=ADMIN_ID.
    await act(async () => {
      (getUserResolver as unknown as (u: { id: string } | null) => void)({ id: ADMIN_ID });
      await Promise.resolve();
    });
    // Query has_role menyelesaikan micro-task queue.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(latest!.isAdmin).toBe(true);
    expect(latest!.isCheckingAdmin).toBe(false);

    // Simulasi urutan yang menyebabkan bug: TOKEN_REFRESHED dua kali dengan
    // session=null (sering terjadi saat WebView reconnect / refresh token
    // gagal parsial), lalu INITIAL_SESSION null, lalu TOKEN_REFRESHED yang
    // akhirnya membawa session yang sama.
    await act(async () => {
      emitAuth("TOKEN_REFRESHED", null);
      emitAuth("TOKEN_REFRESHED", null);
      emitAuth("INITIAL_SESSION", null);
      await Promise.resolve();
    });

    // Kontrak: user tidak dianggap logout. isAdmin tetap true — TIDAK
    // pernah menjadi false di antara event-event ini.
    expect(latest!.isAdmin).toBe(true);

    await act(async () => {
      emitAuth("TOKEN_REFRESHED", ADMIN_ID);
      await Promise.resolve();
    });
    expect(latest!.isAdmin).toBe(true);

    // Sanity check: SIGNED_OUT sungguhan mem-flip ke false.
    await act(async () => {
      emitAuth("SIGNED_OUT", null);
      await Promise.resolve();
    });
    expect(latest!.isAdmin).toBe(false);

    act(() => root.unmount());
  });
});

describe("Sticky admin gate · TugasBaruForm tetap mounted saat TOKEN_REFRESHED null", () => {
  // Harness kecil yang mereplikasi pola gating dari
  // src/routes/_authenticated.tugas-baru.tsx:
  //  - render form segera setelah isAdmin sekali terkonfirmasi
  //  - tetap render form pada mount ini walau isAdmin sesaat berubah
  //  - unmount ketika sticky belum pernah nyala DAN status akhir "bukan admin"
  function Form({ onCount }: { onCount: () => void }) {
    const [qty, setQty] = useState("0");
    // Hanya hitung MOUNT (bukan re-render) — kontrak yang kita jaga
    // adalah form tidak di-unmount/remount saat event auth transient.
    useEffect(() => {
      onCount();
    }, [onCount]);
    return (
      <input
        aria-label="qty"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
      />
    );
  }

  function StickyGate({ onFormMount }: { onFormMount: () => void }) {
    const { isAdmin, isCheckingAdmin } = useAdminStatus();
    const wasAdminRef = useRef(false);
    if (isAdmin) wasAdminRef.current = true;
    if (wasAdminRef.current) return <Form onCount={onFormMount} />;
    if (isCheckingAdmin) return <span data-testid="checking">memeriksa…</span>;
    return <span data-testid="denied">akses ditolak</span>;
  }

  it("input '55' tidak kembali ke draft/0 setelah TOKEN_REFRESHED session=null", async () => {
    const client = makeClient();
    let mountCount = 0;
    const { root, host } = mount(
      <QueryClientProvider client={client}>
        <StickyGate onFormMount={() => { mountCount += 1; }} />
      </QueryClientProvider>,
    );

    // Sebelum getUser resolve: masih "memeriksa…" (bukan "akses ditolak").
    expect(host.querySelector('[data-testid="checking"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="denied"]')).toBeNull();

    // Resolve getUser → admin.
    await act(async () => {
      (getUserResolver as unknown as (u: { id: string } | null) => void)({ id: ADMIN_ID });
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const input = host.querySelector<HTMLInputElement>('input[aria-label="qty"]');
    expect(input).not.toBeNull();
    const mountsAfterAdmin = mountCount;

    // User mengetik "55".
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input!, "55");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input!.value).toBe("55");

    // Sekarang datang urutan yang dulunya membuat form unmount →
    // input kembali ke "0". TOKEN_REFRESHED session=null berkali-kali.
    await act(async () => {
      emitAuth("TOKEN_REFRESHED", null);
      emitAuth("INITIAL_SESSION", null);
      emitAuth("TOKEN_REFRESHED", null);
      await Promise.resolve();
    });

    // Kontrak inti:
    //  (a) tidak pernah swap ke "akses ditolak"
    //  (b) input tetap "55" (bukan "0" / draft)
    //  (c) tidak terjadi remount Form (mountCount stabil)
    expect(host.querySelector('[data-testid="denied"]')).toBeNull();
    const inputAfter = host.querySelector<HTMLInputElement>('input[aria-label="qty"]');
    expect(inputAfter).not.toBeNull();
    expect(inputAfter!.value).toBe("55");
    expect(mountCount).toBe(mountsAfterAdmin);

    // Sanity: SIGNED_OUT sungguhan tidak boleh diblokir sticky — form tetap
    // (sticky sengaja mempertahankan mount ini; sign-out sungguhan ditangani
    // layout `_authenticated` yang redirect ke /auth di level rute).
    // Yang kita jaga di sini adalah: TOKEN_REFRESHED tidak boleh
    // berperilaku seperti SIGNED_OUT.

    act(() => root.unmount());
  });
});