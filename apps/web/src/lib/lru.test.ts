import { describe, expect, it } from "vitest";
import { LruMap } from "./lru.ts";

describe("LruMap", () => {
  it("lets the entry used longest ago go when full", () => {
    const map = new LruMap<string, number>(2);
    map.set("a", 1);
    map.set("b", 2);
    // Reading "a" makes "b" the oldest.
    expect(map.get("a")).toBe(1);
    map.set("c", 3);
    expect(map.has("b")).toBe(false);
    expect(map.get("a")).toBe(1);
    expect(map.get("c")).toBe(3);
    expect(map.size).toBe(2);
  });

  it("keeps a value that is null, and writes over a key in place", () => {
    const map = new LruMap<string, string | null>(2);
    map.set("a", null);
    map.set("a", "x");
    expect(map.size).toBe(1);
    expect(map.get("a")).toBe("x");
    map.set("b", null);
    expect(map.has("b")).toBe(true);
    expect(map.get("b")).toBeNull();
  });
});
