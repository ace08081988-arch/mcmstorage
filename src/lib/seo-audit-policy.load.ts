/**
 * Pemuat `seo-audit.policy.json` (Node/CLI saja — memakai node:fs).
 * Jangan diimpor dari kode aplikasi/browser.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_AUDIT_POLICY, resolvePolicy, type AuditPolicy } from "./seo-audit-policy";

export const POLICY_FILE = "seo-audit.policy.json";

export function loadAuditPolicy(root = process.cwd()): AuditPolicy {
  const file = resolve(root, POLICY_FILE);
  if (!existsSync(file)) return DEFAULT_AUDIT_POLICY;
  try {
    return resolvePolicy(JSON.parse(readFileSync(file, "utf8")));
  } catch (err) {
    throw new Error(`${POLICY_FILE} tidak bisa dibaca: ${(err as Error).message}`);
  }
}
