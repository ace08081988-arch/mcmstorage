#!/usr/bin/env node
/**
 * Harness konkurensi manual untuk RPC submit portal pegawai (Sprint 5).
 *
 * TIDAK dijalankan di CI: butuh fixture nyata di database dan memanggil RPC
 * SECURITY DEFINER lewat kunci anon. Jalankan hanya sengaja, dengan fixture
 * yang Anda buat dan hapus sendiri.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   FIXTURE_JSON=./fixture.json node scripts/concurrency-worker-submit.mjs
 *
 * FIXTURE_JSON: { pin, tasks: { retry, sameKey, diffKey, lowStock, capped },
 *                 items: { retry, sameKey, diffKeyA, diffKeyB, lowStock, capped } }
 * tasks = share_token, items = prep_task_items.id.
 *
 * Hasil yang diharapkan (pagar strukturalnya diuji di
 * tests/integration/worker-submit-ordering.test.ts):
 *   retry beruntun kunci sama  -> submission_id identik, idempotent: true
 *   dua paralel kunci sama     -> submission_id identik, hanya 1 baris submission
 *   dua paralel kunci berbeda  -> 2 submission berbeda, 2 potongan stok
 *   stok kurang                -> insufficient_stock, tanpa mutasi, kunci tidak hangus
 *   melebihi max_submissions   -> ditolak, tepat 1 submission tercatat
 */
const url = process.env["SUPABASE_URL"];
const key = process.env["SUPABASE_ANON_KEY"];
const fixturePath = process.env["FIXTURE_JSON"];
if (!url || !key || !fixturePath) {
  console.error("Butuh SUPABASE_URL, SUPABASE_ANON_KEY, dan FIXTURE_JSON.");
  process.exit(1);
}
const { readFileSync } = await import("node:fs");
const fx = JSON.parse(readFileSync(fixturePath, "utf8"));

async function submit(token, itemId, clientKey) {
  const res = await fetch(`${url}/rest/v1/rpc/prep_submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      _token: token,
      _pin: fx.pin,
      _task_item_id: itemId,
      _photo_path: "qa/concurrency.jpg",
      _photo_paths: ["qa/concurrency.jpg"],
      _location_url: null, _gps_lat: null, _gps_lng: null, _note: null,
      _qty_reported: null, _expected_updated_at: null,
      _client_key: clientKey,
    }),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { http: res.status, raw: text }; }
}

const out = {};
out.sequentialSameKey = [
  await submit(fx.tasks.retry, fx.items.retry, "qa-retry"),
  await submit(fx.tasks.retry, fx.items.retry, "qa-retry"),
];
out.parallelSameKey = await Promise.all([
  submit(fx.tasks.sameKey, fx.items.sameKey, "qa-same"),
  submit(fx.tasks.sameKey, fx.items.sameKey, "qa-same"),
]);
out.parallelDifferentKeys = await Promise.all([
  submit(fx.tasks.diffKey, fx.items.diffKeyA, "qa-diff-a"),
  submit(fx.tasks.diffKey, fx.items.diffKeyB, "qa-diff-b"),
]);
out.insufficientStock = await submit(fx.tasks.lowStock, fx.items.lowStock, "qa-stock");
out.insufficientStockRetry = await submit(fx.tasks.lowStock, fx.items.lowStock, "qa-stock");
out.maxSubmissions = [
  await submit(fx.tasks.capped, fx.items.capped, "qa-cap-1"),
  await submit(fx.tasks.capped, fx.items.capped, "qa-cap-2"),
];
console.log(JSON.stringify(out, null, 2));
