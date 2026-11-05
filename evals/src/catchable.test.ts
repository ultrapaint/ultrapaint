import { describe, expect, it } from "vitest";
import {
  catchableReport,
  countsOf,
  type Sorted,
  type ToSort,
} from "./catchable.ts";

const finding = (id: string, source: string): ToSort => ({
  id,
  source,
  text: `${id} is wrong.`,
  title: `Finding ${id}`,
});

const sorted = (id: string, kind: Sorted["catch"], check = ""): Sorted => ({
  catch: kind,
  check,
  how: `How ${id}.`,
  id,
});

describe("catchable", () => {
  it("counts each kind of catch", () => {
    expect(
      countsOf([sorted("a", "code"), sorted("b", "code"), sorted("c", "eye")])
    ).toEqual({ code: 2, eye: 1, outline: 0 });
  });

  it("reports each source's shares, the checks by how much they'd catch, and what wasn't sorted", () => {
    const findings = [
      finding("g01", "gaps"),
      finding("g02", "gaps"),
      finding("h1", "rated"),
      finding("h2", "rated"),
    ];
    const report = catchableReport(
      "c",
      findings,
      new Map([
        ["g01", sorted("g01", "code", "Target size")],
        ["g02", sorted("g02", "outline")],
        ["h1", sorted("h1", "code", "target size")],
      ]),
      "gpt-6.1-sol"
    );
    expect(report).toContain("| gaps | 2 | 1 (50%) | 1 (50%) | 0 (0%) |");
    expect(report).toContain("| rated | 1 | 1 (100%) | 0 (0%) | 0 (0%) |");
    expect(report).toContain("| target size | 2 |");
    expect(report).toContain("| `h2` Finding h2 | not sorted |  |");
  });
});
