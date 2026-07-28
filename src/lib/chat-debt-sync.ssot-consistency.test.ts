/**
 * Regresi: angka hutang/piutang satu kontak (kasus nyata "Dompeng")
 * WAJIB sama di semua permukaan — chip daftar chat, header dalam chat,
 * dan halaman Hutang & Piutang — karena semuanya membaca SSOT
 * `party_balance_v1()` lewat debtSyncStatus().
 */
import { describe, it, expect } from "vitest";
import {
  debtSyncStatus,
  normalizeParty,
  suggestPartyMatches,
  type DebtSyncMap,
  type PartyLinkMap,
} from "@/lib/chat-debt-sync";
import { debtChipTone } from "@/components/chat/DebtChip";

/** Snapshot SSOT: manual 30,5jt + penjualan hutang 24,5jt = 55jt. */
const MANUAL_DEBTS = 30_500_000;
const SALES_DEBT = 24_500_000;
const SSOT_TOTAL = MANUAL_DEBTS + SALES_DEBT;

function ssotMap(): DebtSyncMap {
  const m: DebtSyncMap = new Map();
  m.set(normalizeParty("Dompeng"), {
    name: "Dompeng",
    hutang: 0,
    piutang: SSOT_TOTAL,
  });
  m.set(normalizeParty("PWNGAT"), { name: "PWNGAT", hutang: 0, piutang: 21_000_000 });
  return m;
}

describe("SSOT saldo kontak konsisten di semua permukaan", () => {
  it("chip daftar chat & header chat memakai angka yang sama", () => {
    const map = ssotMap();
    const fromList = debtSyncStatus("Dompeng", map);
    const fromHeader = debtSyncStatus("dompeng ", map); // beda kapital/spasi
    expect(fromList.state).toBe("open");
    expect(fromHeader.state).toBe("open");
    if (fromList.state === "unlinked" || fromHeader.state === "unlinked") return;
    expect(fromList.entry.piutang).toBe(SSOT_TOTAL);
    expect(fromHeader.entry.piutang).toBe(fromList.entry.piutang);
    expect(fromHeader.entry.hutang).toBe(fromList.entry.hutang);
  });

  it("angka SSOT tidak boleh sama dengan hitungan catatan manual saja", () => {
    const map = ssotMap();
    const st = debtSyncStatus("Dompeng", map);
    if (st.state === "unlinked") throw new Error("harus tertaut");
    expect(st.entry.piutang).not.toBe(MANUAL_DEBTS);
    expect(st.entry.piutang - MANUAL_DEBTS).toBe(SALES_DEBT);
  });

  it("tone chip identik untuk sumber angka yang sama", () => {
    const map = ssotMap();
    const st = debtSyncStatus("Dompeng", map);
    if (st.state === "unlinked") throw new Error("harus tertaut");
    const a = debtChipTone(st.entry.hutang, st.entry.piutang, true);
    const b = debtChipTone(st.entry.hutang, st.entry.piutang, true);
    expect(a).toBe(b);
    expect(a).toBe("piutang");
  });

  it("tautan manual alias dipakai konsisten (PANGAT → PWNGAT)", () => {
    const map = ssotMap();
    const links: PartyLinkMap = new Map([
      [normalizeParty("PANGAT"), normalizeParty("PWNGAT")],
    ]);
    // Tanpa tautan manual pun, nama sangat mirip kini ditautkan otomatis.
    const autoMatched = debtSyncStatus("PANGAT", map);
    if (autoMatched.state === "unlinked") throw new Error("auto-link gagal");
    expect(autoMatched.auto).toBe(true);
    expect(autoMatched.entry.piutang).toBe(21_000_000);
    const linked = debtSyncStatus("PANGAT", map, links);
    if (linked.state === "unlinked") throw new Error("alias gagal");
    expect(linked.auto).toBeFalsy();
    expect(linked.entry.piutang).toBe(21_000_000);
    expect(linked.entry.piutang).toBe(
      (debtSyncStatus("PWNGAT", map) as { entry: { piutang: number } }).entry.piutang,
    );
  });

  it("nama mirip disarankan agar selisih bisa ditelusuri", () => {
    const s = suggestPartyMatches("PANGAT", ssotMap());
    expect(s[0]?.entry.name).toBe("PWNGAT");
  });

  it("saldo nol tetap tertaut (settled), bukan dianggap belum terhubung", () => {
    const map: DebtSyncMap = new Map([
      [normalizeParty("Dompeng"), { name: "Dompeng", hutang: 0, piutang: 0 }],
    ]);
    expect(debtSyncStatus("Dompeng", map).state).toBe("settled");
  });
});