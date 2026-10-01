import { describe, expect, it } from "vitest";
import { MIXED, sameValue, sharedValue, shownAs } from "./shared-value.ts";

describe("sharedValue", () => {
  it("is the value every node has", () => {
    expect(sharedValue([8, 8, 8])).toBe(8);
    expect(sharedValue(["$color-primary"])).toBe("$color-primary");
  });

  it("is unset when no node sets it, null and missing alike", () => {
    expect(sharedValue([undefined, null, undefined])).toBeUndefined();
    expect(sharedValue([])).toBeUndefined();
  });

  it("is mixed when the nodes differ, unset against set too", () => {
    expect(sharedValue([8, 12])).toBe(MIXED);
    expect(sharedValue([8, undefined])).toBe(MIXED);
    expect(sharedValue(["8", 8])).toBe(MIXED);
  });

  it("compares objects by what they hold, in any order", () => {
    // Parsed, so that the keys keep the order they are written in.
    const reversed = JSON.parse('{ "width": 1, "color": "red" }');
    expect(sharedValue([{ color: "red", width: 1 }, reversed])).toEqual({
      color: "red",
      width: 1,
    });
    expect(sharedValue([{ top: 4 }, { left: 2, top: 4 }])).toBe(MIXED);
    expect(sharedValue([{ top: 4 }, { left: null, top: 4 }])).toEqual({
      top: 4,
    });
  });
});

describe("sameValue", () => {
  it("compares lists in order", () => {
    expect(sameValue([1, 2], [1, 2])).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue([1], { 0: 1 })).toBe(false);
  });
});

describe("shownAs", () => {
  it("shows a shared value under the field's own placeholder", () => {
    expect(shownAs(8, "0")).toEqual({ placeholder: "0", value: 8 });
    expect(shownAs(undefined, "Auto")).toEqual({
      placeholder: "Auto",
      value: undefined,
    });
  });

  it("shows nothing but Mixed when the nodes differ", () => {
    expect(shownAs(MIXED, "Auto")).toEqual({
      placeholder: "Mixed",
      value: undefined,
    });
  });
});
