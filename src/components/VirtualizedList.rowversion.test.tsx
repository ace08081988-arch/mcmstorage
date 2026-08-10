// @vitest-environment happy-dom
/**
 * C: baris tidak boleh basi saat state visual eksternal berubah
 * (selecting / selectedIds) walau object item identik.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as React from "react";
import { VirtualizedList } from "./VirtualizedList";

type Item = { id: string; label: string };

function Harness({ count }: { count: number }) {
  // Identitas item SENGAJA stabil (tidak dibuat ulang tiap render).
  const items = React.useMemo<Item[]>(
    () => Array.from({ length: count }, (_, i) => ({ id: `c${i}`, label: `Chat ${i}` })),
    [count],
  );
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const selecting = selectedIds.size > 0;
  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <button onClick={() => toggle("c0")}>toggle-c0</button>
      <VirtualizedList
        cacheKey={`test-${count}`}
        items={items}
        getKey={(c) => c.id}
        threshold={5}
        rowVersion={`${selecting ? 1 : 0}|${Array.from(selectedIds).sort().join(",")}`}
        renderItem={(c) => (
          <div data-testid={`row-${c.id}`}>
            {c.label} | mode={selecting ? "select" : "normal"} |{" "}
            {selectedIds.has(c.id) ? "checked" : "unchecked"}
          </div>
        )}
      />
    </div>
  );
}

function scenario(name: string, count: number) {
  it(`${name} (${count} item): toggle langsung merefleksikan UI terbaru`, () => {
    render(<Harness count={count} />);
    expect(screen.getByTestId("row-c0").textContent).toContain("unchecked");
    expect(screen.getByTestId("row-c0").textContent).toContain("mode=normal");

    fireEvent.click(screen.getByText("toggle-c0"));
    expect(screen.getByTestId("row-c0").textContent).toContain("checked");
    expect(screen.getByTestId("row-c0").textContent).toContain("mode=select");
    // Baris lain juga harus ikut pindah ke mode seleksi.
    expect(screen.getByTestId("row-c1").textContent).toContain("mode=select");

    fireEvent.click(screen.getByText("toggle-c0"));
    expect(screen.getByTestId("row-c0").textContent).toContain("unchecked");
    expect(screen.getByTestId("row-c0").textContent).toContain("mode=normal");
    cleanup();
  });
}

describe("VirtualizedList rowVersion", () => {
  // di bawah threshold → render biasa
  scenario("mode biasa", 3);
  // di atas threshold → mode virtual
  scenario("mode virtual", 12);

  it("tanpa rowVersion tetap aman (fallback tanpa custom comparator)", () => {
    const spy = vi.fn();
    function Plain() {
      const items = React.useMemo(() => [{ id: "a" }], []);
      const [n, setN] = React.useState(0);
      return (
        <div>
          <button onClick={() => setN(n + 1)}>bump</button>
          <VirtualizedList
            cacheKey="plain"
            items={items}
            getKey={(i) => i.id}
            renderItem={() => {
              spy();
              return <div data-testid="plain-row">n={n}</div>;
            }}
          />
        </div>
      );
    }
    render(<Plain />);
    fireEvent.click(screen.getByText("bump"));
    expect(screen.getByTestId("plain-row").textContent).toBe("n=1");
    cleanup();
  });
});
