// @vitest-environment happy-dom
/**
 * Integration guard: badge angka di ReadyRequestSection dan ReadyEcerSection
 * WAJIB berasal dari `countActiveByTitle` di `@/lib/prep-active-selector`.
 *
 * Dua lapis pertahanan:
 *   1. Render integration untuk ReadyRequestSection — mount komponen dengan
 *      supabase yang di-mock, lalu bandingkan angka pada badge `"N paket"`
 *      persis dengan output helper `countActiveByTitle(preps)`.
 *   2. Structural lockdown untuk ReadyEcerSection — file terlalu besar untuk
 *      di-mount lengkap tanpa membebani test dengan stub Radix/realtime yang
 *      rapuh. Sebagai gantinya kami mengunci di level sumber bahwa BADGE
 *      "N kotak siap" hanya membaca `prep_count` dari `countMap` yang
 *      dihasilkan `countActiveByTitle`, dan tidak ada jalur lain yang
 *      mengisi `prep_count` selain lewat map itu.
 *
 * Selama helper `countActiveByTitle` di-tes di `prep-active-selector.test.ts`,
 * kombinasi kedua lapisan ini menjamin badge di dua permukaan tetap sinkron.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { countActiveByTitle } from "@/lib/prep-active-selector";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// ── Fixture bersama: dipakai oleh mock supabase & assertion. ─────────────
type Title = { id: string; name: string };
type Prep = { id: string; title_id: string; sold_at: string | null };

const titles: Title[] = [
  { id: "t-A", name: "Paket Alpha" },
  { id: "t-B", name: "Paket Beta" },
  { id: "t-C", name: "Paket Gamma" }, // tidak punya prep sama sekali
];

const preps: Prep[] = [
  // t-A: 3 aktif, 2 sudah terkirim
  { id: "p1", title_id: "t-A", sold_at: null },
  { id: "p2", title_id: "t-A", sold_at: null },
  { id: "p3", title_id: "t-A", sold_at: null },
  { id: "p4", title_id: "t-A", sold_at: "2026-07-01T00:00:00Z" },
  { id: "p5", title_id: "t-A", sold_at: "2026-07-02T00:00:00Z" },
  // t-B: 4 aktif, 0 terkirim
  { id: "p6", title_id: "t-B", sold_at: null },
  { id: "p7", title_id: "t-B", sold_at: null },
  { id: "p8", title_id: "t-B", sold_at: null },
  { id: "p9", title_id: "t-B", sold_at: null },
  // prep milik title yang sudah dihapus (harus diabaikan)
  { id: "p10", title_id: "t-ghost", sold_at: null },
];

// ── Mock supabase: query builder mini yang mendukung .select/.order/.in/.is ──
// `.is("sold_at", null)` benar-benar memfilter fixture supaya kalau server-side
// filter hilang, angka klien pun ikut berubah dan tes gagal.
vi.mock("@/integrations/supabase/client", () => {
  function builder(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: any[] =
      table === "request_titles"
        ? titles.map((t, i) => ({ ...t, position: i, created_at: `2026-07-0${i + 1}` }))
        : table === "request_title_items"
          ? []
          : table === "warehouse_items"
            ? []
            : table === "request_preparations"
              ? preps
              : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    b.select = () => b;
    b.order = () => b;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.in = (col: string, vals: any[]) => {
      rows = rows.filter((r) => vals.includes(r[col]));
      return b;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.is = (col: string, val: any) => {
      rows = rows.filter((r) => (r[col] ?? null) === val);
      return b;
    };
    b.gte = () => b;
    b.limit = () => b;
    // Thenable → memungkinkan `await sb.from(...).select(...)`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.then = (resolve: (v: { data: any[]; error: null }) => void) =>
      resolve({ data: rows, error: null });
    return b;
  }
  return {
    supabase: {
      from: (t: string) => builder(t),
      channel: () => ({
        on() { return this; },
        subscribe() { return this; },
      }),
      removeChannel: () => {},
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    },
  };
});

// Stub ringan agar mount ReadyRequestSection tidak menyeret dependency berat.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (require("react") as any).createElement("a", rest, children);
  },
}));
vi.mock("@/lib/debt-tx-event", () => ({ useOnDebtTx: () => {} }));
vi.mock("@/components/LayoutModeToggle", () => ({
  useLayoutMode: () => ["list" as const, () => {}],
  layoutGridClass: () => "",
  LayoutModeToggle: () => null,
}));

import { ReadyRequestSection } from "@/components/ReadyRequestSection";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container?.parentNode) container.parentNode.removeChild(container);
  container = null;
  root = null;
});

function mount(el: ReactElement) {
  act(() => root!.render(el));
}
async function flush() {
  // Beberapa microtask: initial render → load() await → setState → re-render.
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

describe("ReadyRequestSection — badge 'N paket' konsisten dengan countActiveByTitle", () => {
  it("angka badge tiap judul == countActiveByTitle(preps).get(id) ?? 0", async () => {
    mount(<ReadyRequestSection />);
    await flush();

    // Angka referensi datang dari SATU-SATUNYA selector.
    const expected = countActiveByTitle(preps);

    for (const t of titles) {
      // Cari kartu judul lewat teks nama, lalu ambil angka pada badge.
      const card = Array.from(container!.querySelectorAll("a")).find((a) =>
        a.textContent?.includes(t.name),
      );
      expect(card, `kartu untuk ${t.name} harus dirender`).toBeTruthy();
      const badge = card!.querySelector("span.rounded.bg-primary\\/10");
      expect(badge, `badge 'N paket' untuk ${t.name} harus ada`).toBeTruthy();
      const shown = Number((badge!.textContent ?? "").replace(/[^0-9]/g, ""));
      expect(shown).toBe(expected.get(t.id) ?? 0);
    }
  });

  it("prep milik title yang sudah dihapus tidak menambah badge manapun", async () => {
    // Regresi guard: `p10` (title_id = 't-ghost') tidak boleh muncul di
    // badge judul manapun — countActiveByTitle mengabaikan title yang tak
    // ada di daftar titles saat konsumsi map.
    mount(<ReadyRequestSection />);
    await flush();

    const badges = Array.from(container!.querySelectorAll("span.rounded.bg-primary\\/10"));
    const total = badges.reduce(
      (n, b) => n + Number((b.textContent ?? "").replace(/[^0-9]/g, "")),
      0,
    );
    // t-A aktif: 3, t-B aktif: 4, t-C aktif: 0 → total 7. Prep 'p10' diabaikan.
    expect(total).toBe(7);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Structural lockdown untuk ReadyEcerSection.
//
// File aslinya >2400 baris dan menarik banyak dependency (Radix popover,
// realtime, share dialogs). Alih-alih mount penuh yang rapuh, kami mengunci
// invariant di level sumber: badge `"N kotak siap"` HANYA dihidrasi lewat
// `countActiveByTitle`, dan query preparation-nya memakai filter aktif
// yang sama. Bila salah satu hilang, test gagal dan orang berikutnya harus
// sadar sedang memutus kontrak konsistensi antar-badge.
// ────────────────────────────────────────────────────────────────────────
describe("ReadyEcerSection — struktur sumber mengunci badge ke selector", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/components/ReadyEcerSection.tsx"),
    "utf8",
  );

  it("mengimpor countActiveByTitle dari selector tunggal", () => {
    expect(src).toMatch(
      /from\s+["']@\/lib\/prep-active-selector["']/,
    );
    expect(src).toMatch(/countActiveByTitle/);
  });

  it("membangun countMap via countActiveByTitle(preps aktif)", () => {
    // Bentuk canonical yang di-lock: `const countMap = countActiveByTitle(`
    // (whitespace toleran) di sekitar load().
    expect(src).toMatch(/const\s+countMap\s*=\s*countActiveByTitle\(/);
  });

  it("badge 'N kotak siap' membaca prep_count dari countMap", () => {
    // Field prep_count di baris pemetaan HANYA boleh diisi countMap.get(t.id).
    // Regex sengaja ketat: mencegah ada jalur lain (misal panjang array)
    // menyusup mengisi field ini.
    expect(src).toMatch(/prep_count:\s*countMap\.get\(t\.id\)\s*\?\?\s*0/);
    // Dan JSX badge memang membaca r.prep_count di kalimat "N kotak siap".
    expect(src).toMatch(/\{r\.prep_count\}\s*kotak siap/);
  });

  it("query ecer_preparations tetap difilter aktif di server via helper", () => {
    // Sabuk kedua: server-side filter tidak boleh dilepas — kalau lepas,
    // countActiveByTitle di klien tetap benar, tapi payload jaringan
    // membengkak & badge lain bisa ikut miring. Filter WAJIB via
    // `withActivePrepsFilter` supaya semantiknya tunggal.
    // withActivePrepsFilter membungkus builder → panggilannya DI ATAS
    // literal "ecer_preparations". Cari window 400 char sebelum & sesudah.
    const idx = src.indexOf("ecer_preparations");
    expect(idx, "blok query ecer_preparations ada").toBeGreaterThan(0);
    const window = src.slice(Math.max(0, idx - 400), idx + 400);
    expect(window).toMatch(/withActivePrepsFilter\(/);
    // Literal .is("sold_at", null) tidak boleh muncul lagi di file —
    // dijaga juga oleh ESLint no-restricted-syntax.
    expect(src).not.toMatch(/\.is\(\s*["']sold_at["']\s*,\s*null\s*\)/);
  });
});
