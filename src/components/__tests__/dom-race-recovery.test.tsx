// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DomRaceBoundary, requestDomRaceReset } from "@/components/DomRaceBoundary";
import { DomRaceRecoveryPanel } from "@/components/DomRaceRecoveryPanel";

let host: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>,
    );
  });
}

function Boom({ crash }: { crash: { on: boolean } }) {
  if (crash.on) {
    const e = new Error("Failed to execute 'removeChild' on 'Node'");
    e.name = "NotFoundError";
    throw e;
  }
  return <div data-testid="ok">konten gudang</div>;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

describe("pemulihan cepat DomRaceBoundary", () => {
  it("fallback menampilkan tombol pemulihan tanpa reload halaman", () => {
    const crash = { on: true };
    render(
      <DomRaceBoundary
        label="gudang"
        renderFallback={(error, reset, info) => (
          <DomRaceRecoveryPanel error={error} reset={reset} info={info} />
        )}
      >
        <Boom crash={crash} />
      </DomRaceBoundary>,
    );

    const buttons = Array.from(host.querySelectorAll("button")).map((b) => b.textContent ?? "");
    expect(buttons.some((t) => t.includes("Pulihkan komponen"))).toBe(true);
    expect(buttons.some((t) => t.includes("Pulihkan + segarkan data"))).toBe(true);
    expect(buttons.some((t) => t.includes("Muat ulang halaman"))).toBe(true);
  });

  it("tombol 'Pulihkan komponen' me-remount subtree jadi sehat kembali", () => {
    const crash = { on: true };
    render(
      <DomRaceBoundary
        label="gudang"
        renderFallback={(error, reset, info) => (
          <DomRaceRecoveryPanel error={error} reset={reset} info={info} />
        )}
      >
        <Boom crash={crash} />
      </DomRaceBoundary>,
    );
    expect(host.querySelector('[data-testid="ok"]')).toBeNull();

    crash.on = false;
    const btn = Array.from(host.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Pulihkan komponen"),
    )!;
    act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(host.querySelector('[data-testid="ok"]')?.textContent).toBe("konten gudang");
  });

  it("requestDomRaceReset('gudang') memulihkan boundary berlabel sama", () => {
    const crash = { on: true };
    render(
      <DomRaceBoundary
        label="gudang"
        renderFallback={(error, reset, info) => (
          <DomRaceRecoveryPanel error={error} reset={reset} info={info} />
        )}
      >
        <Boom crash={crash} />
      </DomRaceBoundary>,
    );
    crash.on = false;
    act(() => requestDomRaceReset("gudang"));
    expect(host.querySelector('[data-testid="ok"]')).not.toBeNull();
  });

  it("sinyal untuk label lain diabaikan", () => {
    const crash = { on: true };
    render(
      <DomRaceBoundary
        label="gudang"
        renderFallback={(error, reset, info) => (
          <DomRaceRecoveryPanel error={error} reset={reset} info={info} />
        )}
      >
        <Boom crash={crash} />
      </DomRaceBoundary>,
    );
    crash.on = false;
    act(() => requestDomRaceReset("chat"));
    expect(host.querySelector('[data-testid="ok"]')).toBeNull();
  });
});
