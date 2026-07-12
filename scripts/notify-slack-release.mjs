#!/usr/bin/env node
/**
 * Post ringkasan job "aab-release" ke Slack Incoming Webhook.
 *
 * Dipanggil oleh .github/workflows/aab-release.yml sebagai step terakhir
 * (kondisional: hanya jalan kalau secret SLACK_WEBHOOK_URL di-set).
 *
 * Sumber data:
 *   - Env vars dari workflow: RELEASE_OUTCOME, VARIANT, TRACK,
 *     RELEASE_STATUS, DRY_RUN, SKIP_VERSION_CHECK, RUN_URL,
 *     GITHUB_ACTOR, GITHUB_REF_NAME, GITHUB_EVENT_NAME.
 *   - File JSON dari scripts/upload-play.mjs (UPLOAD_PLAY_SUMMARY_JSON):
 *     berisi { local, play, uploaded, committed, outcome, error, ... }.
 *
 * Kalau file JSON tidak ada (mis. build gagal sebelum upload-play jalan),
 * tetap kirim notifikasi minimal berbasis env vars supaya tim tetap tahu.
 */
import { existsSync, readFileSync } from "node:fs";

const webhook = process.env.SLACK_WEBHOOK_URL;
if (!webhook) {
  console.log("SLACK_WEBHOOK_URL kosong — lewati notifikasi.");
  process.exit(0);
}

const summaryPath = process.env.UPLOAD_PLAY_SUMMARY_JSON;
let s = null;
if (summaryPath && existsSync(summaryPath)) {
  try {
    s = JSON.parse(readFileSync(summaryPath, "utf8"));
  } catch (err) {
    console.warn("Gagal parse summary JSON:", err?.message ?? err);
  }
}

const outcome = s?.outcome ?? mapJobOutcome(process.env.RELEASE_OUTCOME);
const emoji =
  outcome === "success"
    ? "✅"
    : outcome === "dry-run"
      ? "🧪"
      : outcome === "failed"
        ? "❌"
        : outcome === "cancelled"
          ? "⏹️"
          : "ℹ️";

const variant = s?.variant ?? process.env.VARIANT ?? "full";
const track = s?.track ?? process.env.TRACK ?? "internal";
const releaseStatus = s?.releaseStatus ?? process.env.RELEASE_STATUS ?? "draft";
const dryRun =
  typeof s?.dryRun === "boolean" ? s.dryRun : String(process.env.DRY_RUN) === "true";
const skipVer =
  typeof s?.skipVersionCheck === "boolean"
    ? s.skipVersionCheck
    : String(process.env.SKIP_VERSION_CHECK) === "true";

const localVc = s?.local?.versionCode ?? "—";
const localVn = s?.local?.versionName ?? "—";
const playMax = s?.play?.maxOverall ?? "—";
const trackInfo = s?.play?.tracks?.[track];
const trackVc = trackInfo?.maxVersionCode ?? "—";
const trackVn = trackInfo?.maxVersionName ?? "—";
const uploadedVc = s?.uploaded?.versionCode ?? "—";
const committed = s?.committed ? "yes" : "no";

const outcomeLabel =
  outcome === "success"
    ? "Uploaded & committed"
    : outcome === "dry-run"
      ? "Dry-run (tidak upload)"
      : outcome === "failed"
        ? "GAGAL"
        : outcome === "cancelled"
          ? "Dibatalkan"
          : String(outcome);

const modeLabel = dryRun ? "🧪 dry-run" : "🚀 upload";
const skipLabel = skipVer ? " · ⚠ skip-version-check" : "";

const lines = [
  `${emoji} *AAB Release — ${outcomeLabel}*`,
  `• Varian: \`${variant}\`  ·  Track: \`${track}\`  ·  Status: \`${releaseStatus}\``,
  `• Mode: ${modeLabel}${skipLabel}  ·  Committed: \`${committed}\``,
  `• Lokal: \`vc=${localVc}\` \`vn=${localVn}\``,
  `• Play (tertinggi semua bundle): \`vc=${playMax}\`  ·  Track \`${track}\`: \`vc=${trackVc}\` \`vn=${trackVn}\``,
  `• Terupload: \`vc=${uploadedVc}\``,
];
if (s?.error) lines.push(`• Error: \`${String(s.error).replace(/`/g, "'").slice(0, 300)}\``);

const runUrl = process.env.RUN_URL;
const actor = process.env.GITHUB_ACTOR;
const ref = process.env.GITHUB_REF_NAME;
const trigger = process.env.GITHUB_EVENT_NAME;
const footerBits = [];
if (trigger) footerBits.push(`trigger: \`${trigger}\``);
if (ref) footerBits.push(`ref: \`${ref}\``);
if (actor) footerBits.push(`by @${actor}`);
if (footerBits.length) lines.push(`_${footerBits.join(" · ")}_`);
if (runUrl) lines.push(`<${runUrl}|Lihat job di GitHub Actions →>`);
const artifactUrl = process.env.ARTIFACT_URL;
if (artifactUrl) lines.push(`<${artifactUrl}|📦 Download artifact (AAB + mapping.txt) →>`);

const text = lines.join("\n");

const res = await fetch(webhook, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text }),
});
if (!res.ok) {
  console.error(`Slack webhook gagal (${res.status}): ${await res.text()}`);
  // Jangan bikin job gagal hanya karena notifikasi tidak terkirim.
  process.exit(0);
}
console.log("✓ Notifikasi Slack terkirim.");

function mapJobOutcome(o) {
  switch (o) {
    case "success":
      return "success";
    case "failure":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "skipped":
      return "skipped";
    default:
      return o ?? "unknown";
  }
}