import { describe, expect, it } from "vitest";
import { problemParts } from "./page-problem.ts";

describe("an invalid page's problem in plain words", () => {
  it("says what a place holds and the values it may hold", () => {
    expect(
      problemParts(
        'Expected "row" | "column" | "group" | "text", got "colum"\n  at ["root"]["children"][0]["type"]'
      )
    ).toEqual([
      {
        at: "root.children[0].type",
        says: "is “colum”: make it one of “row”, “column”, “group” or “text”.",
      },
    ]);
  });

  it("names the two values a place may hold, and the value it should be", () => {
    expect(
      problemParts(
        'Expected "row" | "column"\n  at ["root"]["children"][0]["type"]'
      )
    ).toEqual([
      {
        at: "root.children[0].type",
        says: "should be “row” or “column”.",
      },
    ]);
    expect(problemParts('Expected "page"\n  at ["root"]["type"]')).toEqual([
      { at: "root.type", says: "should be “page”." },
    ]);
  });

  it("says each thing missing on its own", () => {
    expect(
      problemParts(
        'Missing key\n  at ["root"]["children"]\nMissing key\n  at ["root"]["id"]'
      )
    ).toEqual([
      { at: "root.children", says: "is missing: add it." },
      { at: "root.id", says: "is missing: add it." },
    ]);
  });

  it("keeps a message it does not know as it is", () => {
    expect(
      problemParts("not JSON: Unexpected token } in JSON at position 4")
    ).toEqual([
      {
        at: null,
        says: "not JSON: Unexpected token } in JSON at position 4",
      },
    ]);
  });
});
