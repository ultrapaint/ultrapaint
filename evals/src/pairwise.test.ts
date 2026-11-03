import { assert, describe, it } from "@effect/vitest";
import { shownAs, skillReads, tallyOf, unblind } from "./pairwise.ts";

describe("pairwise", () => {
  it("shows a run's two designs in the order its name gives, as the rounds judged so far were", () => {
    // From runs/r2-main-blank-vs-r2-ch-blank/pairwise.json: each run's `shownFirst`.
    assert.deepStrictEqual(
      shownAs("r2-main-blank", "r2-ch-blank", "alignui-waitlist/run-1"),
      ["r2-main-blank", "r2-ch-blank"]
    );
    assert.deepStrictEqual(
      shownAs("r2-main-blank", "r2-ch-blank", "austrace-contact/run-1"),
      ["r2-ch-blank", "r2-main-blank"]
    );
    assert.deepStrictEqual(
      shownAs("r2-main-blank", "r2-ch-blank", "baserow-grid/run-1"),
      ["r2-main-blank", "r2-ch-blank"]
    );
  });

  it("turns the judge's letters into the rounds they were shown as, a tie staying a tie", () => {
    const verdict = {
      levels: { colour: "B", layout: "A", spacing: "tie" },
      margin: "slight",
      reasons: ["B's table reads first"],
      winner: "B",
    } as const;
    assert.deepStrictEqual(unblind(verdict, ["candidate", "baseline"]), {
      levels: { colour: "baseline", layout: "candidate", spacing: "tie" },
      margin: "slight",
      reasons: ["B's table reads first"],
      shownFirst: "candidate",
      winner: "baseline",
    });
    assert.deepStrictEqual(
      unblind({ ...verdict, winner: "tie" }, ["baseline", "candidate"]).winner,
      "tie"
    );
  });

  it("tallies the runs each round won, overall and level by level", () => {
    const judged = (
      winner: string,
      levels: Readonly<Record<string, string>>
    ) => ({ levels, margin: "clear", reasons: [], shownFirst: "a", winner });
    assert.deepStrictEqual(
      tallyOf({
        "home/run-1": judged("a", { colour: "tie", layout: "a" }),
        "home/run-2": judged("b", { colour: "b", layout: "a" }),
        "pricing/run-1": judged("a", { colour: "b", layout: "a" }),
      }),
      {
        a: 2,
        b: 1,
        "colour:b": 2,
        "colour:tie": 1,
        "layout:a": 3,
      }
    );
  });

  it("reads the skill's files a trace opened from the skills' cache, each once", () => {
    const trace = [
      "- · Read /home/me/.cache/ultrapaint/skills/abc/design.md",
      "- · Read /home/me/.cache/ultrapaint/skills/abc/patterns/dialogs.md",
      "- · Read /home/me/.cache/ultrapaint/skills/abc/design.md",
      "- · Read /home/me/.cache/ultrapaint/skills/abc/studies/color.md and layout.md",
      "- · Read /home/me/project/notes.md",
      "- ✗ get_screenshot",
    ].join("\n");
    assert.deepStrictEqual(skillReads(trace), [
      "design.md",
      "layout.md",
      "patterns/dialogs.md",
      "studies/color.md",
    ]);
    assert.deepStrictEqual(skillReads(""), []);
  });
});
