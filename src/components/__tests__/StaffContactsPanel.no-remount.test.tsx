// @vitest-environment happy-dom
/**
 * Regresi guard: `StaffContactsPanel` tidak boleh remount / re-fetch setiap
 * kali parent (`TugasPage`) re-render. Bug historis: `ViaPegawaiBlock`
 * didefinisikan sebagai nested component dan dipakai sebagai
 * `<ViaPegawaiBlock />`, yang membuat React memperlakukannya sebagai tipe
 * komponen baru setiap render → unmount+mount subtree → StaffContactsPanel
 * memanggil `select()` berulang-ulang.
 *
 * Test ini mengunci dua kontrak:
 *   1. Sumber: `_authenticated.tugas.tsx` merender `ViaPegawaiBlock`
 *      sebagai pemanggilan fungsi biasa, BUKAN elemen JSX.
 *   2. Perilaku: parent yang re-render berulang kali (mensimulasikan
 *      state parent berubah) hanya memicu satu mount + satu `select()`
 *      di panel; pola JSX-anti (bug) memicu ≥2 mount + ≥2 select.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// ── Mock supabase client: hitung berapa kali `select()` dipanggil ──────
let selectCalls = 0;
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => {
    selectCalls++;
    return chain;
  };
  chain.order = async () => ({ data: [], error: null });
  chain.insert = async () => ({ error: null });
  chain.delete = () => ({ eq: async () => ({ error: null }) });
  return {
    supabase: {
      from: () => chain,
      auth: {
        getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
      },
    },
  };
});

vi.mock("sonner", () => ({
  toast: { error: () => {}, success: () => {}, warning: () => {}, info: () => {} },
}));
vi.mock("@/lib/confirm", () => ({ confirm: async () => false }));
vi.mock("@/lib/share-wa", () => ({ buildWhatsAppUrl: () => "" }));

import { StaffContactsPanel } from "@/components/StaffContactsPanel";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container && container.parentNode) container.parentNode.removeChild(container);
  container = null;
  root = null;
  selectCalls = 0;
});

function mount(el: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("StaffContactsPanel — no remount on parent re-render", () => {
  it("pola fix (Block() sebagai function call) — 1 select meski parent re-render 3x", async () => {
    let bump: (() => void) | null = null;
    function Parent() {
      const [n, setN] = useState(0);
      bump = () => setN((v) => v + 1);
      function ViaPegawaiBlock() {
        return <StaffContactsPanel uid="u1" />;
      }
      return <div data-tick={n}>{ViaPegawaiBlock()}</div>;
    }

    mount(<Parent />);
    await flush();

    for (let i = 0; i < 3; i++) {
      act(() => bump!());
      await flush();
    }

    expect(selectCalls).toBe(1);
  });

  it("pola bug (<Block /> sebagai JSX) — remount + select berulang; membuktikan alasan fix", async () => {
    let bump: (() => void) | null = null;
    function Parent() {
      const [n, setN] = useState(0);
      bump = () => setN((v) => v + 1);
      // Sengaja anti-pola: identitas komponen berubah tiap render.
      const ViaPegawaiBlock = () => <StaffContactsPanel uid="u1" />;
      return (
        <div data-tick={n}>
          <ViaPegawaiBlock />
        </div>
      );
    }

    mount(<Parent />);
    await flush();
    for (let i = 0; i < 3; i++) {
      act(() => bump!());
      await flush();
    }

    expect(selectCalls).toBeGreaterThan(1);
  });
});

describe("Sumber `_authenticated.tugas.tsx` — memakai pola fix", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/routes/_authenticated.tugas.tsx"),
    "utf8",
  );

  it("merender ViaPegawaiBlock sebagai function call, bukan JSX element", () => {
    expect(src).toMatch(/ViaPegawaiBlock\(\)/);
    expect(src).not.toMatch(/<ViaPegawaiBlock\s*\/?>/);
  });
});
