// @vitest-environment happy-dom
import type { RoundFinding } from "@ultrapaint/contracts/threads";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReviewItem } from "../lib/design-run.ts";
import { Rounds } from "./thread-review.tsx";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const finding = (
  title: string,
  more: Partial<RoundFinding> = {}
): RoundFinding => ({
  category: "layout",
  fix: "Set them apart",
  problem: "They touch",
  reviewer: "m0",
  severity: "minor",
  title,
  where: "Files list",
  ...more,
});

/** A round the designer answered, declining the findings given. */
const round = (findings: readonly RoundFinding[]): ReviewItem => ({
  at: 1,
  findings,
  fixed: 0,
  id: "r1",
  kind: "review",
  maxRounds: 6,
  reviewers: [],
  round: 1,
});

describe("a review round's declined findings", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const lines = () =>
    [...host.querySelectorAll("li li")].map((li) => li.textContent);

  it("mark a check's finding as a check's", () => {
    act(() =>
      root.render(
        <Rounds
          rounds={[
            round([
              finding("Rows touching", {
                check: "touching-rows",
                declined: "The list is one card on purpose",
                reviewer: "check",
              }),
            ]),
          ]}
        />
      )
    );
    expect(lines()).toEqual([
      "Rows touchingDeclined check: The list is one card on purpose",
    ]);
  });

  it("leave a reviewer's finding unmarked", () => {
    act(() =>
      root.render(
        <Rounds
          rounds={[
            round([finding("Header too loud", { declined: "The brief asks" })]),
          ]}
        />
      )
    );
    expect(lines()).toEqual(["Header too loudDeclined: The brief asks"]);
  });
});
