// @vitest-environment happy-dom
/**
 * Regresi "render storm" portal pegawai: countdown sesi & label sinkron
 * punya timer internal, jadi kartu item (memo) TIDAK boleh rerender sama
 * sekali selama 10 detik idle.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import * as React from "react";
import { SessionCountdown, SyncAgeLabel, DeferredHoldSeconds } from "./PrepTimeTickers";

afterEach(cleanup);

let leafRenders = 0;
const Leaf = React.memo(function Leaf({ label }: { label: string }) {
  leafRenders += 1;
  return <div data-testid="leaf">{label}</div>;
});

function Portal({ expiresAt, lastSyncAt }: { expiresAt: number; lastSyncAt: number }) {
  const onRelogin = React.useCallback(() => {}, []);
  return (
    <div>
      <SessionCountdown expiresAt={expiresAt} onRelogin={onRelogin} />
      <span>
        <SyncAgeLabel lastSyncAt={lastSyncAt} />
      </span>
      <span>
        <DeferredHoldSeconds since={lastSyncAt} />
      </span>
      <Leaf label="Beras 5kg" />
    </div>
  );
}

describe("timer terisolasi di komponen daun", () => {
  it("ItemCard-like leaf: 0 rerender akibat timer selama 10 detik idle", () => {
    vi.useFakeTimers();
    try {
      leafRenders = 0;
      const now = Date.now();
      render(<Portal expiresAt={now + 30 * 60_000} lastSyncAt={now} />);
      expect(leafRenders).toBe(1);
      for (let i = 0; i < 10; i++) {
        React.act(() => {
          vi.advanceTimersByTime(1000);
        });
      }
      // Label waktu ikut berdetak, kartu tidak.
      expect(leafRenders).toBe(1);
      expect(screen.getByTestId("leaf").textContent).toBe("Beras 5kg");
    } finally {
      vi.useRealTimers();
    }
  });

  it("SessionCountdown menampilkan jam mundur mm:ss", () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      render(<SessionCountdown expiresAt={now + 65_000} onRelogin={() => {}} />);
      expect(screen.getByText(/Sesi 01:05/)).toBeTruthy();
      React.act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByText(/Sesi 01:00/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
