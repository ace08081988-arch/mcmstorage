/**
 * Kontrak dedup alert `portal_error_alerts`:
 *   - Dedup di-key oleh (kind, code) — cooldown lintas token.
 *   - Kombinasi (kind, code) yang sama hanya menghasilkan SATU alert
 *     baru dalam jendela cooldown. Request berikutnya di-suppress atau
 *     digabung ke alert terbuka.
 *   - Alert terbuka (belum di-ack) → merge count/severity, tidak buat baru.
 *   - Alert sudah di-ack tapi masih dalam cooldown → suppress.
 *   - Alert sudah di-ack dan sudah lewat cooldown → boleh buat alert baru.
 *   - Escalation ke `critical` saat count ≥ 3× threshold.
 */
import { describe, it, expect } from "vitest";
import { decideAlertAction } from "../log-portal-error";

const ALERT_COUNT = 5;
const COOLDOWN_SEC = 1800; // 30 menit
const NOW = new Date("2026-07-06T10:00:00Z");

function iso(offsetSec: number): string {
  return new Date(NOW.getTime() + offsetSec * 1000).toISOString();
}

describe("decideAlertAction — dedup per (kind, code) dengan cooldown", () => {
  it("belum ada alert → insert baru dengan severity warning", () => {
    const d = decideAlertAction({
      existing: null,
      nowCount: 5,
      alertCount: ALERT_COUNT,
      cooldownSec: COOLDOWN_SEC,
      now: NOW,
    });
    expect(d).toEqual({ action: "insert", count: 5, severity: "warning" });
  });

  it("count ≥ 3× threshold → severity critical saat insert", () => {
    const d = decideAlertAction({
      existing: null,
      nowCount: 15,
      alertCount: ALERT_COUNT,
      cooldownSec: COOLDOWN_SEC,
      now: NOW,
    });
    expect(d).toEqual({ action: "insert", count: 15, severity: "critical" });
  });

  it("alert terbuka (belum di-ack) → merge bump count", () => {
    const d = decideAlertAction({
      existing: {
        id: "a1",
        count: 6,
        severity: "warning",
        created_at: iso(-60),
        acknowledged_at: null,
      },
      nowCount: 10,
      alertCount: ALERT_COUNT,
      cooldownSec: COOLDOWN_SEC,
      now: NOW,
    });
    expect(d).toEqual({ action: "merge", id: "a1", count: 10, severity: "warning" });
  });

  it("alert terbuka + count naik ke escalation → merge critical", () => {
    const d = decideAlertAction({
      existing: {
        id: "a1",
        count: 5,
        severity: "warning",
        created_at: iso(-60),
        acknowledged_at: null,
      },
      nowCount: 20,
      alertCount: ALERT_COUNT,
      cooldownSec: COOLDOWN_SEC,
      now: NOW,
    });
    expect(d.action).toBe("merge");
    if (d.action === "merge") {
      expect(d.severity).toBe("critical");
      expect(d.count).toBe(20);
    }
  });

  it("alert terbuka tapi tidak ada perubahan → suppress no_change", () => {
    const d = decideAlertAction({
      existing: {
        id: "a1",
        count: 10,
        severity: "warning",
        created_at: iso(-60),
        acknowledged_at: null,
      },
      nowCount: 5,
      alertCount: ALERT_COUNT,
      cooldownSec: COOLDOWN_SEC,
      now: NOW,
    });
    expect(d).toEqual({ action: "suppress", reason: "no_change" });
  });

  it("alert sudah di-ack, masih dalam cooldown → suppress cooldown", () => {
    const d = decideAlertAction({
      existing: {
        id: "a1",
        count: 8,
        severity: "warning",
        created_at: iso(-600), // 10 menit lalu, cooldown 30 menit
        acknowledged_at: iso(-500),
      },
      nowCount: 6,
      alertCount: ALERT_COUNT,
      cooldownSec: COOLDOWN_SEC,
      now: NOW,
    });
    expect(d).toEqual({ action: "suppress", reason: "cooldown" });
  });

  it("alert sudah di-ack DAN sudah lewat cooldown → insert baru", () => {
    const d = decideAlertAction({
      existing: {
        id: "a1",
        count: 8,
        severity: "warning",
        created_at: iso(-COOLDOWN_SEC - 60),
        acknowledged_at: iso(-COOLDOWN_SEC),
      },
      nowCount: 6,
      alertCount: ALERT_COUNT,
      cooldownSec: COOLDOWN_SEC,
      now: NOW,
    });
    expect(d).toEqual({ action: "insert", count: 6, severity: "warning" });
  });

  it("simulasi burst: satu kombinasi (kind, code) hanya insert 1× dalam cooldown", () => {
    // Request pertama: belum ada alert → insert.
    const first = decideAlertAction({
      existing: null,
      nowCount: 5,
      alertCount: ALERT_COUNT,
      cooldownSec: COOLDOWN_SEC,
      now: NOW,
    });
    expect(first.action).toBe("insert");

    // Simulasikan alert baru yg langsung di-ack admin (skenario worst-case:
    // ack cepat, lalu burst berlanjut).
    const ackedAlert = {
      id: "a1",
      count: 5,
      severity: "warning" as const,
      created_at: NOW.toISOString(),
      acknowledged_at: iso(60),
    };

    // 20 request berikutnya dalam cooldown (dari token manapun, kind+code sama)
    // → SEMUA harus suppress. Tidak ada satupun yang insert alert baru.
    for (let i = 1; i <= 20; i++) {
      const later = new Date(NOW.getTime() + i * 60_000); // per menit
      if (later.getTime() - NOW.getTime() >= COOLDOWN_SEC * 1000) break;
      const d = decideAlertAction({
        existing: ackedAlert,
        nowCount: 5 + i,
        alertCount: ALERT_COUNT,
        cooldownSec: COOLDOWN_SEC,
        now: later,
      });
      expect(d.action).toBe("suppress");
      if (d.action === "suppress") expect(d.reason).toBe("cooldown");
    }

    // Setelah cooldown lewat → insert baru boleh terjadi.
    const afterCooldown = decideAlertAction({
      existing: ackedAlert,
      nowCount: 6,
      alertCount: ALERT_COUNT,
      cooldownSec: COOLDOWN_SEC,
      now: new Date(NOW.getTime() + (COOLDOWN_SEC + 60) * 1000),
    });
    expect(afterCooldown.action).toBe("insert");
  });
});