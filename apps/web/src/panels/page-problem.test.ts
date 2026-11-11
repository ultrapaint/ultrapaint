import { describe, expect, it } from "vitest";
import { problemParts, type Said } from "./page-problem.ts";

/** A sentence as it reads, its values in backticks where they are set in code. */
const read = (says: readonly Said[]) =>
  says.map((s) => (s.code ? `\`${s.text}\`` : s.text)).join("");

const readAll = (problem: string) =>
  problemParts(problem).map((part) => ({ at: part.at, says: read(part.says) }));

describe("an invalid page's problem in plain words", () => {
  it("says what a place holds and the values it may hold, each value in code", () => {
    expect(
      readAll(
        'Expected "row" | "column" | "group" | "text", got "colum"\n  at ["root"]["children"][0]["type"]'
      )
    ).toEqual([
      {
        at: "root.children[0].type",
        says: 'is `"colum"`: make it one of `"row"`, `"column"`, `"group"` or `"text"`.',
      },
    ]);
  });

  it("names the two values a place may hold, and the value it should be", () => {
    expect(
      readAll('Expected "row" | "column"\n  at ["root"]["children"][0]["type"]')
    ).toEqual([
      {
        at: "root.children[0].type",
        says: 'should be `"row"` or `"column"`.',
      },
    ]);
    expect(readAll('Expected "page"\n  at ["root"]["type"]')).toEqual([
      { at: "root.type", says: 'should be `"page"`.' },
    ]);
  });

  it("says each thing missing on its own", () => {
    expect(
      readAll(
        'Missing key\n  at ["root"]["children"]\nMissing key\n  at ["root"]["id"]'
      )
    ).toEqual([
      { at: "root.children", says: "is missing: add it." },
      { at: "root.id", says: "is missing: add it." },
    ]);
  });

  it("keeps a message it does not know as it is, in words", () => {
    expect(problemParts("the file is gone")).toEqual([
      { at: null, says: [{ code: false, text: "the file is gone" }] },
    ]);
  });

  it("says a file the parser refused in one sentence, the text it quotes in code", () => {
    expect(
      readAll(
        'not JSON: Unexpected token \'<\', ..."ldren": [\n<<<<<<< HE"... is not valid JSON'
      )
    ).toEqual([
      {
        at: null,
        says: 'The file isn’t JSON: unexpected token `<` in `ldren": [ <<<<<<< HE`.',
      },
    ]);
    expect(
      readAll(
        "not JSON: Expected ',' or '}' after property value in JSON at position 7 (line 1 column 8)"
      )
    ).toEqual([
      {
        at: null,
        says: "The file isn’t JSON: expected `,` or `}` after property value in JSON at position 7 (line 1 column 8).",
      },
    ]);
    expect(readAll("not JSON: Unexpected end of JSON input")).toEqual([
      { at: null, says: "The file isn’t JSON: unexpected end of JSON input." },
    ]);
  });
});
