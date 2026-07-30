import { describe, expect, it, beforeEach } from "vitest";
import {
  getListPerfSnapshot,
  recordListMount,
  recordListRender,
  resetListPerf,
} from "@/lib/list-perf";

describe("list-perf", () => {
  beforeEach(() => resetListPerf());

  it("agregasi render time & jumlah re-render per route/list", () => {
    recordListMount("/request", "request-active");
    recordListRender("/request", "request-active", 10, 100, 12);
    recordListRender("/request", "request-active", 30, 100, 12);
    const [s] = getListPerfSnapshot();
    expect(s.renders).toBe(2);
    expect(s.mounts).toBe(1);
    expect(s.avgMs).toBe(20);
    expect(s.maxMs).toBe(30);
    expect(s.slowFrames).toBe(1);
    expect(s.items).toBe(100);
  });

  it("memisahkan metrik per route", () => {
    recordListRender("/chat", "chat-list", 5, 10, 5);
    recordListRender("/request", "chat-list", 5, 10, 5);
    expect(getListPerfSnapshot()).toHaveLength(2);
  });
});
