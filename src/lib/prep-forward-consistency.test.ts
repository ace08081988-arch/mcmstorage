import { describe, it, expect } from "vitest";

/**
 * Regression E2E-style (murni JS, tanpa jaringan): mereplikasi pipeline
 * "Ready Ecer" — persis algoritma di src/components/ReadyEcerSection.tsx —
 * untuk memverifikasi konsistensi alur:
 *   1) Owner membuat BEBERAPA penyiapan (ecer_titles + prep_task_items dgn
 *      ecer_title_id) yang berbagi produk sama tapi varian berbeda
 *      (1G / ST / SPR / GS).
 *   2) Pegawai mengirim (prep_submissions) — masing-masing terikat ke
 *      prep_task_items yang berbeda.
 *   3) Bucketing HARUS men-drop tiap kiriman ke title-nya sendiri
 *      berdasarkan ecer_title_id (bukan heuristik grams/unit) sehingga
 *      foto tidak "nyasar" ke varian lain.
 *   4) Payload WhatsApp per varian membawa foto yang benar; forward ulang
 *      (kirim kedua kali) menghasilkan payload IDENTIK — idempoten.
 *
 * Ini menutup gap yang menjadi penyebab bug historis: bila kiriman pegawai
 * dicocokkan via wid|grams|unit saja, semua varian dgn wid+grams sama
 * akan runtuh ke title pertama.
 */

type PackageUnit = "g" | "botol" | "sachet" | "pcs";

interface EcerTitle {
  id: string;
  warehouse_item_id: string;
  target_grams: number;
  unit_label: PackageUnit;
  variant_label: "1G" | "ST" | "SPR" | "GS";
}

interface PrepTaskItem {
  id: string;
  warehouse_item_id: string;
  qty_requested: number;
  unit_label: PackageUnit;
  ecer_title_id: string | null;
  name_snapshot: string;
}

interface PrepSubmission {
  id: string;
  task_item_id: string;
  photo_path: string;
  location_url: string | null;
  submitted_at: string;
}

interface WaAttachmentPayload {
  titleId: string;
  variant: EcerTitle["variant_label"];
  photos: string[];
  location_urls: string[];
}

/**
 * Replika pipeline bucketing di ReadyEcerSection (lihat baris ~223–282
 * file tersebut). Prioritas: ecer_title_id → strict wid|grams|unit →
 * fallback wid|grams → fallback wid.
 */
function bucketSubmissions(
  titles: EcerTitle[],
  items: PrepTaskItem[],
  subs: PrepSubmission[],
): Map<string, PrepSubmission[]> {
  const titleIds = titles.map((t) => t.id);
  const normUnit = (u: PackageUnit | null | undefined) => (u ?? "").toString().trim().toLowerCase();
  const titleStrict = new Map<string, string>();
  const titleByWidGrams = new Map<string, string[]>();
  const titleByWid = new Map<string, string[]>();
  for (const t of titles) {
    const wid = t.warehouse_item_id;
    const g = Number(t.target_grams) || 0;
    const u = normUnit(t.unit_label);
    titleStrict.set(`${wid}|${g}|${u}`, t.id);
    const a = titleByWidGrams.get(`${wid}|${g}`) ?? [];
    a.push(t.id); titleByWidGrams.set(`${wid}|${g}`, a);
    const b = titleByWid.get(wid) ?? [];
    b.push(t.id); titleByWid.set(wid, b);
  }
  const itemMeta = new Map(items.map((i) => [i.id, i]));
  const out = new Map<string, PrepSubmission[]>();
  for (const t of titles) out.set(t.id, []);
  for (const s of subs) {
    const meta = itemMeta.get(s.task_item_id);
    if (!meta) continue;
    let titleId: string | undefined;
    if (meta.ecer_title_id && titleIds.includes(meta.ecer_title_id)) {
      titleId = meta.ecer_title_id;
    } else {
      const wid = meta.warehouse_item_id;
      const g = Number(meta.qty_requested) || 0;
      const u = normUnit(meta.unit_label);
      titleId = titleStrict.get(`${wid}|${g}|${u}`)
        ?? titleByWidGrams.get(`${wid}|${g}`)?.[0]
        ?? titleByWid.get(wid)?.[0];
    }
    if (!titleId) continue;
    out.get(titleId)!.push(s);
  }
  // Sort tiap bucket berdasarkan submitted_at desc — konsisten dgn UI.
  for (const arr of out.values()) arr.sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
  return out;
}

/**
 * Bangun payload WA per varian dari hasil bucket. Payload deterministik
 * agar forward-ulang menghasilkan output identik.
 */
function buildWaPayloads(
  titles: EcerTitle[],
  buckets: Map<string, PrepSubmission[]>,
): WaAttachmentPayload[] {
  return titles
    .map((t) => {
      const shots = buckets.get(t.id) ?? [];
      return {
        titleId: t.id,
        variant: t.variant_label,
        photos: shots.map((s) => s.photo_path),
        location_urls: shots
          .map((s) => s.location_url)
          .filter((u): u is string => u !== null),
      } satisfies WaAttachmentPayload;
    })
    .sort((a, b) => a.titleId.localeCompare(b.titleId));
}

// ---------- Fixture ----------
const WID = "wid-beras-premium";
const TITLES: EcerTitle[] = [
  { id: "title-1g", warehouse_item_id: WID, target_grams: 1000, unit_label: "g", variant_label: "1G" },
  { id: "title-st", warehouse_item_id: WID, target_grams: 1000, unit_label: "g", variant_label: "ST" },
  { id: "title-spr", warehouse_item_id: WID, target_grams: 1000, unit_label: "g", variant_label: "SPR" },
  { id: "title-gs", warehouse_item_id: WID, target_grams: 1000, unit_label: "botol", variant_label: "GS" },
];

function makeItem(id: string, titleId: string, unit: PackageUnit = "g", qty = 1000): PrepTaskItem {
  return {
    id, warehouse_item_id: WID, qty_requested: qty, unit_label: unit,
    ecer_title_id: titleId, name_snapshot: "Beras Premium",
  };
}

function makeSub(id: string, itemId: string, path: string, at = "2026-01-01T00:00:00Z"): PrepSubmission {
  return { id, task_item_id: itemId, photo_path: path, location_url: null, submitted_at: at };
}

describe("E2E prep flow — konsistensi create → send → forward WA", () => {
  it("beberapa varian di produk yang sama tidak saling nyasar", () => {
    const items = [
      makeItem("ti-1g", "title-1g"),
      makeItem("ti-st", "title-st"),
      makeItem("ti-spr", "title-spr"),
      makeItem("ti-gs", "title-gs", "botol"),
    ];
    const subs = [
      makeSub("s-1g", "ti-1g", "photo/1g.jpg", "2026-01-01T00:00:00Z"),
      makeSub("s-st", "ti-st", "photo/st.jpg", "2026-01-01T00:01:00Z"),
      makeSub("s-spr", "ti-spr", "photo/spr.jpg", "2026-01-01T00:02:00Z"),
      makeSub("s-gs", "ti-gs", "photo/gs.jpg", "2026-01-01T00:03:00Z"),
    ];
    const buckets = bucketSubmissions(TITLES, items, subs);
    expect(buckets.get("title-1g")!.map((s) => s.photo_path)).toEqual(["photo/1g.jpg"]);
    expect(buckets.get("title-st")!.map((s) => s.photo_path)).toEqual(["photo/st.jpg"]);
    expect(buckets.get("title-spr")!.map((s) => s.photo_path)).toEqual(["photo/spr.jpg"]);
    expect(buckets.get("title-gs")!.map((s) => s.photo_path)).toEqual(["photo/gs.jpg"]);
  });

  it("qty_requested berbeda antar item tidak mengaburkan bucketing (ecer_title_id memegang)", () => {
    // Kasus historis: item ST/SPR punya qty_requested yang beda (mis. 500,
    // 2000) — heuristik grams akan gagal, tapi ecer_title_id tetap benar.
    const items = [
      makeItem("ti-1g", "title-1g", "g", 500),
      makeItem("ti-st", "title-st", "g", 2000),
      makeItem("ti-spr", "title-spr", "g", 3000),
      makeItem("ti-gs", "title-gs", "botol", 1),
    ];
    const subs = [
      makeSub("s-1g", "ti-1g", "p1.jpg"),
      makeSub("s-st", "ti-st", "p2.jpg"),
      makeSub("s-spr", "ti-spr", "p3.jpg"),
      makeSub("s-gs", "ti-gs", "p4.jpg"),
    ];
    const buckets = bucketSubmissions(TITLES, items, subs);
    expect(buckets.get("title-1g")!.map((s) => s.id)).toEqual(["s-1g"]);
    expect(buckets.get("title-st")!.map((s) => s.id)).toEqual(["s-st"]);
    expect(buckets.get("title-spr")!.map((s) => s.id)).toEqual(["s-spr"]);
    expect(buckets.get("title-gs")!.map((s) => s.id)).toEqual(["s-gs"]);
  });

  it("payload WA per varian membawa foto sendiri (tidak silang)", () => {
    const items = [
      makeItem("ti-1g", "title-1g"),
      makeItem("ti-st", "title-st"),
      makeItem("ti-spr", "title-spr"),
      makeItem("ti-gs", "title-gs", "botol"),
    ];
    const subs = [
      makeSub("s-1g", "ti-1g", "photo/1g.jpg"),
      makeSub("s-st", "ti-st", "photo/st.jpg"),
      makeSub("s-spr", "ti-spr", "photo/spr.jpg"),
      makeSub("s-gs", "ti-gs", "photo/gs.jpg"),
    ];
    const payloads = buildWaPayloads(TITLES, bucketSubmissions(TITLES, items, subs));
    const map = new Map(payloads.map((p) => [p.variant, p.photos]));
    expect(map.get("1G")).toEqual(["photo/1g.jpg"]);
    expect(map.get("ST")).toEqual(["photo/st.jpg"]);
    expect(map.get("SPR")).toEqual(["photo/spr.jpg"]);
    expect(map.get("GS")).toEqual(["photo/gs.jpg"]);
    // Tidak ada payload yang memiliki foto milik varian lain.
    for (const p of payloads) {
      const other = payloads.filter((q) => q.variant !== p.variant).flatMap((q) => q.photos);
      for (const ph of p.photos) expect(other).not.toContain(ph);
    }
  });

  it("forward-ulang WA menghasilkan payload IDENTIK (idempoten)", () => {
    const items = [
      makeItem("ti-1g", "title-1g"),
      makeItem("ti-st", "title-st"),
      makeItem("ti-spr", "title-spr"),
      makeItem("ti-gs", "title-gs", "botol"),
    ];
    const subs = [
      makeSub("s-1g", "ti-1g", "photo/1g.jpg"),
      makeSub("s-st", "ti-st", "photo/st.jpg"),
      makeSub("s-spr", "ti-spr", "photo/spr.jpg"),
      makeSub("s-gs", "ti-gs", "photo/gs.jpg"),
    ];
    const first = buildWaPayloads(TITLES, bucketSubmissions(TITLES, items, subs));
    const second = buildWaPayloads(TITLES, bucketSubmissions(TITLES, items, subs));
    expect(second).toEqual(first);
  });

  it("kiriman ganda pada satu varian ter-agregasi di title yang sama saja", () => {
    const items = [
      makeItem("ti-1g", "title-1g"),
      makeItem("ti-st", "title-st"),
    ];
    const subs = [
      makeSub("s-1g-a", "ti-1g", "photo/1g-a.jpg", "2026-01-01T00:00:00Z"),
      makeSub("s-1g-b", "ti-1g", "photo/1g-b.jpg", "2026-01-01T00:05:00Z"),
      makeSub("s-st-a", "ti-st", "photo/st-a.jpg", "2026-01-01T00:10:00Z"),
    ];
    const buckets = bucketSubmissions(TITLES, items, subs);
    // Terurut desc by submitted_at.
    expect(buckets.get("title-1g")!.map((s) => s.id)).toEqual(["s-1g-b", "s-1g-a"]);
    expect(buckets.get("title-st")!.map((s) => s.id)).toEqual(["s-st-a"]);
    expect(buckets.get("title-spr")!.length).toBe(0);
    expect(buckets.get("title-gs")!.length).toBe(0);
  });

  it("fallback: item lama tanpa ecer_title_id → strict wid|grams|unit tetap mengarahkan", () => {
    const items: PrepTaskItem[] = [
      { ...makeItem("ti-1g", "title-1g"), ecer_title_id: null },
      { ...makeItem("ti-gs", "title-gs", "botol"), ecer_title_id: null },
    ];
    const subs = [
      makeSub("s-1g", "ti-1g", "photo/1g.jpg"),
      makeSub("s-gs", "ti-gs", "photo/gs.jpg"),
    ];
    const buckets = bucketSubmissions(TITLES, items, subs);
    // Strict match: 1G (wid|1000|g) → title-1g ATAU title-st/spr (semua strict-eq).
    // titleStrict.set menyimpan yg TERAKHIR — title-spr. Ini adalah risiko
    // yang secara sengaja diselesaikan lewat ecer_title_id. Test mengunci
    // perilaku fallback: kiriman GS (botol) tetap ke title-gs, dan kiriman
    // 1G/ST/SPR akan mendarat di SATU title unit=g (tidak boleh nyebrang ke GS).
    const gsBucket = buckets.get("title-gs")!;
    expect(gsBucket.map((s) => s.id)).toEqual(["s-gs"]);
    const gTitleShots = ["title-1g", "title-st", "title-spr"]
      .map((id) => buckets.get(id)!.map((s) => s.id))
      .flat();
    expect(gTitleShots).toEqual(["s-1g"]);
  });

  it("kiriman tanpa task_item_id yang cocok → di-drop (tidak mencemari bucket manapun)", () => {
    const items = [makeItem("ti-1g", "title-1g")];
    const subs = [
      makeSub("s-orphan", "ti-hilang", "photo/orphan.jpg"),
      makeSub("s-1g", "ti-1g", "photo/1g.jpg"),
    ];
    const buckets = bucketSubmissions(TITLES, items, subs);
    expect(buckets.get("title-1g")!.map((s) => s.id)).toEqual(["s-1g"]);
    for (const [, arr] of buckets) {
      expect(arr.find((s) => s.id === "s-orphan")).toBeUndefined();
    }
  });

  it("alur lengkap: create 4 varian → kirim → forward → payload stabil & tidak overlap", () => {
    // 1) Owner membuat 4 varian.
    const titles = TITLES;
    // 2) prep_task_items tercatat dgn ecer_title_id (jalur baru).
    const items = [
      makeItem("ti-1g", "title-1g"),
      makeItem("ti-st", "title-st"),
      makeItem("ti-spr", "title-spr"),
      makeItem("ti-gs", "title-gs", "botol"),
    ];
    // 3) Pegawai mengirim satu-per-satu (submitted_at berurut).
    const subs = [
      makeSub("s-1g", "ti-1g", "photo/1g.jpg", "2026-01-01T09:00:00Z"),
      makeSub("s-st", "ti-st", "photo/st.jpg", "2026-01-01T09:05:00Z"),
      makeSub("s-spr", "ti-spr", "photo/spr.jpg", "2026-01-01T09:10:00Z"),
      makeSub("s-gs", "ti-gs", "photo/gs.jpg", "2026-01-01T09:15:00Z"),
    ];
    const payloadsA = buildWaPayloads(titles, bucketSubmissions(titles, items, subs));
    // 4) Forward via WA (kali kedua) — payload harus identik byte-for-byte.
    const payloadsB = buildWaPayloads(titles, bucketSubmissions(titles, items, subs));
    expect(JSON.stringify(payloadsB)).toBe(JSON.stringify(payloadsA));
    // 5) Setiap payload persis 1 foto & tidak ada duplikasi lintas varian.
    const all = payloadsA.flatMap((p) => p.photos);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual([
      "photo/1g.jpg", "photo/gs.jpg", "photo/spr.jpg", "photo/st.jpg",
    ]);
  });
});