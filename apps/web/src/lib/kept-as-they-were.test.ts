import { describe, expect, it } from "vitest";
import { keptAsTheyWere } from "./kept-as-they-were.ts";

const page = (id: string, name = id) => ({ id, name });

describe("a list the server sends again", () => {
  it("is the same list when nothing in it changed", () => {
    const before = [page("a"), page("b")];
    expect(keptAsTheyWere(before, [page("a"), page("b")])).toBe(before);
  });

  it("keeps what did not change and takes what did", () => {
    const before = [page("a"), page("b")];
    const after = keptAsTheyWere(before, [page("a"), page("b", "Renamed")]);
    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toEqual(page("b", "Renamed"));
  });

  it("takes an added page and drops a removed one", () => {
    const before = [page("a"), page("b")];
    const after = keptAsTheyWere(before, [page("b"), page("c")]);
    expect(after.map((p) => p.id)).toEqual(["b", "c"]);
    expect(after[0]).toBe(before[1]);
  });
});
