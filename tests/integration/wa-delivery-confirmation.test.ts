import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ---------- Unit: helper konfirmasi pasca-share ----------
const confirmMock = vi.fn();
vi.mock("@/lib/confirm", () => ({ confirm: (o: unknown) => confirmMock(o) }));

describe("post-share-confirm helper", () => {
  beforeEach(() => confirmMock.mockReset());

  it('bertanya eksplisit "sudah terkirim?" dengan aksi Ya/Belum', async () => {
    const { confirmWhatsAppDelivered, WA_DELIVERY_CONFIRM_TITLE, WA_DELIVERY_CONFIRM_YES, WA_DELIVERY_CONFIRM_NO } =
      await import("@/lib/post-share-confirm");
    confirmMock.mockResolvedValue(true);
    await expect(confirmWhatsAppDelivered("ringkasan")).resolves.toBe(true);
    const opts = confirmMock.mock.calls[0][0] as Record<string, string>;
    expect(opts.title).toBe(WA_DELIVERY_CONFIRM_TITLE);
    expect(opts.confirmText).toBe(WA_DELIVERY_CONFIRM_YES);
    expect(opts.cancelText).toBe(WA_DELIVERY_CONFIRM_NO);
    expect(WA_DELIVERY_CONFIRM_TITLE).toMatch(/benar-benar sudah terkirim/i);
  });

  it('mengembalikan false saat owner memilih "Belum/batal"', async () => {
    const { confirmWhatsAppDelivered } = await import("@/lib/post-share-confirm");
    confirmMock.mockResolvedValue(false);
    await expect(confirmWhatsAppDelivered()).resolves.toBe(false);
  });

  it("isShareOpened hanya benar untuk shared/fallback", async () => {
    const { isShareOpened } = await import("@/lib/post-share-confirm");
    expect(isShareOpened("shared")).toBe(true);
    expect(isShareOpened("fallback")).toBe(true);
    expect(isShareOpened("cancelled")).toBe(false);
    expect(isShareOpened("failed")).toBe(false);
  });

  it("createReentryLock mencegah commit kedua (double tap)", async () => {
    const { createReentryLock } = await import("@/lib/post-share-confirm");
    const lock = createReentryLock();
    let commits = 0;
    const run = async () => {
      if (!lock.acquire()) return;
      try { commits++; await Promise.resolve(); } finally { lock.release(); }
    };
    await Promise.all([run(), run()]);
    expect(commits).toBe(1);
    await run();
    expect(commits).toBe(2);
  });
});

// ---------- Urutan kanonik di ECER ----------
describe("ECER: share -> konfirmasi -> RPC finansial", () => {
  const src = read("src/routes/_authenticated.ecer.tsx");
  const share = src.indexOf("await shareToWhatsApp(");
  const confirmIdx = src.indexOf("await confirmWhatsAppDelivered(");
  const rpc = src.indexOf('rpc("send_ecer_preps_to_customer"');

  it("RPC tidak dipanggil sebelum share dan konfirmasi", () => {
    expect(share).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(share);
    expect(rpc).toBeGreaterThan(confirmIdx);
  });

  it("share cancelled/failed keluar tanpa RPC dan mencatat outcome non-sent", () => {
    const guard = src.indexOf("if (!isShareOpened(res.status))");
    expect(guard).toBeGreaterThan(share);
    expect(guard).toBeLessThan(rpc);
    const block = src.slice(guard, rpc);
    expect(block).toContain('logSendEvent(failed ? "failed" : "cancelled"');
  });

  it('pilihan "Belum" mencatat cancelled dan tidak commit', () => {
    const block = src.slice(confirmIdx, rpc);
    expect(block).toContain("if (!delivered)");
    expect(block).toContain('logSendEvent("cancelled"');
  });

  it('outcome "sent" hanya ditulis setelah RPC sukses', () => {
    const sent = src.indexOf('logSendEvent("sent"');
    expect(sent).toBeGreaterThan(rpc);
  });

  it("melakukan read-back sebelum melaporkan gagal (anti transaksi ganda)", () => {
    expect(src).toContain("async function alreadyCommitted()");
    expect(src).toContain("if (!(await alreadyCommitted()))");
  });

  it("terkunci dari double tap lewat reentry lock", () => {
    expect(src).toContain("sendLock.current.acquire()");
    expect(src).toContain("sendLock.current.release()");
  });
});

// ---------- Urutan kanonik di Request ----------
describe("Request: share -> konfirmasi -> RPC finansial", () => {
  const src = read("src/routes/_authenticated.request.tsx");
  const share = src.indexOf("await shareToWhatsApp(");
  const confirmIdx = src.indexOf("await confirmWhatsAppDelivered(");
  const rpc = src.indexOf('rpc("send_request_prep_to_customer"');

  it("RPC hanya setelah share + konfirmasi eksplisit", () => {
    expect(share).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(share);
    expect(rpc).toBeGreaterThan(confirmIdx);
  });

  it("cancelled/failed tidak commit", () => {
    const block = src.slice(share, confirmIdx);
    expect(block).toContain('res.status === "cancelled"');
    expect(block).toContain('res.status === "failed"');
    expect(block).toContain("penjualan BELUM dicatat");
  });

  it('"Belum" menghentikan alur sebelum RPC', () => {
    const block = src.slice(confirmIdx, rpc);
    expect(block).toContain("if (!delivered)");
    expect(block).toContain("Ditandai belum terkirim");
  });

  it("read-back saat RPC error, bukan retry buta", () => {
    const after = src.slice(rpc);
    expect(after).toContain('.select("id, sold_at")');
    expect(after).toContain("if (!committed) throw rpcErr;");
  });

  it("double tap dikunci oleh reentry lock", () => {
    expect(src).toContain("if (!sendLock.current.acquire()) return;");
    expect(src).toContain("sendLock.current.release();");
  });
});
