import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VirtualizedList } from "@/components/VirtualizedList";

const items = Array.from({ length: 200 }, (_, i) => ({ id: String(i) }));

describe("VirtualizedList", () => {
  it("renders all items below threshold", () => {
    render(
      <VirtualizedList
        items={items.slice(0, 10)}
        getKey={(x) => x.id}
        renderItem={(x) => <span>row-{x.id}</span>}
      />,
    );
    expect(screen.getAllByText(/^row-/)).toHaveLength(10);
  });

  it("renders only a window of items above threshold", () => {
    render(
      <VirtualizedList
        items={items}
        getKey={(x) => x.id}
        renderItem={(x) => <span>row-{x.id}</span>}
      />,
    );
    const rendered = screen.getAllByText(/^row-/);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(200);
  });
});
