// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { memoryStorage } from "./storage.ts";

describe("memoryStorage", () => {
  it("keeps items through its methods and as properties", () => {
    const storage = memoryStorage();
    storage.setItem("theme", "dark");
    (storage as unknown as Record<string, string>).onboarded = "1";
    expect(storage.getItem("onboarded")).toBe("1");
    expect((storage as unknown as Record<string, string>).theme).toBe("dark");
    expect(storage.length).toBe(2);
    expect(Object.keys(storage)).toEqual(["theme", "onboarded"]);
    expect(storage.key(1)).toBe("onboarded");
    storage.removeItem("theme");
    expect(storage.getItem("theme")).toBeNull();
    storage.clear();
    expect(storage.length).toBe(0);
  });

  it("is a Storage, as code that checks expects", () => {
    expect(memoryStorage()).toBeInstanceOf(Storage);
  });
});
